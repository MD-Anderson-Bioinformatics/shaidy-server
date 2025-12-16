/*

Copyright (C) 2025 The University of Texas MD Anderson Cancer Center

This file is part of shiady server.

shaidy server is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License Version 2 as published by the Free Software Foundation.

shaidy server is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with shaidy server.
If not, see <https://www.gnu.org/licenses/>.

*/

"use strict";

const spawn = require('child_process').spawn; // eslint-disable-line security/detect-child-process

const debug = false;
const storage = require('./storage');
const dataAccessServices = require('./data-access-services');

/* This function orchestrates the rendering of an NGCHM.
 *
 * Specifically, it:
 * - Stages in all objects required for rendering the NGCHM.
 * - Calls the renderer.
 * - Stages out the rendered NGCHM.
 *
 * Calls renderingCompleted(true) if all steps succeed.
 * Calls renderingCompleted(false) otherwise.
 */
function stageAndRenderCHM (chmId, callback) {
    if (debug) console.log ('stageAndRenderCHM ' + chmId);
    dataAccessServices.getObjectsForRender(chmId)
    .then(objs => {
        const tasks = objs.map( (oo) => {
            if (debug) console.log ('Staging in ' + oo);
            const ff = oo.split('/');
            return storage.stageInIfNeeded (ff[0], ff[1]);
        });
        return Promise.all (tasks)
            .then ((res) => {
	        if (debug) console.log ('stageAndRenderCHM ' + chmId + ' stage in completed');
                return true;
            })
            .catch((err) => {
	        console.log ('stageAndRenderCHM ' + chmId + ' stageIn failed:');
	        console.error (err);
                return false;
            });
    })
    .catch(err => {
        console.log ('stageAndRenderCHM ' + chmId + ' getObjectsForRender failed:');
        console.error (err);
        return false;
    })
    .then (success => {
	return success && actuallyRenderCHM (chmId);
    })
    .catch(err => {
        console.log ('stageAndRenderCHM ' + chmId + ' Render failed:');
        console.error (err);
        return false;
    })
    .then(success => {
        return success && storage.stageOutIfNeeded ('viewer', chmId);
    })
    .catch(err => {
	console.log ('stageAndRenderCHM ' + chmId + ' stageOut failed:');
	console.error (err);
        return false;
    })
    .then(success => {
	renderingCompleted (success, chmId);
    });
}

/* rendersInProgress is a database of renders in progress so
 * impatient clients don't start multiple redundant and
 * conflicting renders on the same NGCHM.
 */
var rendersInProgress = [];

/* Get all render records for the specified NGCHM.
 * The returned array will have either 0 or 1 entries.
 * It will have 1 entry iff the NGCHM is being
 * rendered.
 */
function getRIP (objectId) {
    return rendersInProgress.filter (function (rip) {
        return (rip.shaid === objectId);
    });
}

/* Remove all render records for the specified NGCHM.
 */
function removeRIP( objectId ) {
    rendersInProgress = rendersInProgress.filter (function (rip) {
      return (rip.shaid !== objectId);
    });
}

/* Add res to the list of waiting responses upon completion of rendering.
 * Return true iff we are the first(only) client waiting for a response.
 */
function addRIP ( objectId, res ) {
    const rr = getRIP (objectId);
    if (rr.length > 0) {
      /* Append res to existing waiters for this NGCHM. */
      rr[0].res.push (res);
      return false;
    } else {
      /* Create new RIP element for this NGCHM. */
      rendersInProgress.push({shaid: objectId, res: [res]});
      return true;
    }
};

/* Rendering completed.
 * Send an appropriate response to all waiting clients.
 * Some clients may have gone away, leading to errors
 * sending responses.  Catch any such errors so that
 * all clients can be responded to if possible.
 */
function renderingCompleted (success, objectId) {
    // Get list of responses waiting for a reply.
    const rr = getRIP( objectId );
    for (let ii = 0; ii < rr[0].res.length; ii++) {
        try {
          if (success) {
            rr[0].res[ii].status(200).send('[]');
          } else {
            rr[0].res[ii].status(500).send('render failed');
          }
        } catch (err) {
          // Could not respond to client ii.  Not much more we can do.
          console.log ('Error sending response after rendering chm/' + objectId + ':');
          console.error (err);
        }
    }
    removeRIP( objectId );
}

/** Express finalware that creates a viewable NG-CHM from a shaidy NG-CHM.
 * A 200 response is sent if the rendering is successful; a 500 response
 * is sent otherwise.  Only a single rendering is performed for a given NG-CHM,
 * even if there are multiple concurrent render requests for that NG-CHM.
 * The same response is sent to all render requests when the rendering completes.
 * - Prerequisite: req.objectId is set to the shaid of the NG-CHM to render.
 *
 * @function
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 */
exports.renderCHM = renderCHM;
function renderCHM (req, res) {
  if (addRIP (req.objectId, res)) {
      // Noone else already rendering this NGCHM.
      if (req.query.force) {
        // We must redo rendering even if object already rendered.
        stageAndRenderCHM (req.objectId);
      } else {
        // Not being forced, so check whether the CHM has already been rendered.
        const viewPath = storage.getObjectPath('viewer', req.objectId);
        storage.objectExists (viewPath, function (exists) {
          if (exists) {
            // Already rendered and not being forced to redo.
            renderingCompleted (true, req.objectId);
          } else {
            // Not already rendered, so actually render CHM.
            stageAndRenderCHM (req.objectId);
          }
        });
      }
  }
}

/* This code actually renders the chm objectId on the local machine.
 * All objects required for rendering must already be the local machine.
 * The resulting viewer object is left on the local machine.
 * The function returns a promise for a success code: true iff the render
 * succeeded.
 */
const actuallyRenderCHM = (function() {
    /* Create a closure containing java options etc. */
    const javaCommand = process.env.JAVA_COMMAND || 'java';
    const shaidyMapGen = process.env.SHAIDY_MAP_GEN || '/NGCHM/shaidymapgen/ShaidyMapGen.jar';
    console.log ('JAVA_COMMAND is ' + javaCommand);
    console.log ('SHAIDY_MAP_GEN is ' + shaidyMapGen);
    console.log ('JAVA_OPTIONS are ' + process.env.JAVA_OPTIONS);
    const javaOptions = process.env.JAVA_OPTIONS ? process.env.JAVA_OPTIONS.split(' ') : [];
    const repoPath = storage.getLocalRepoPath();
    console.log ('SHAIDY local repository is ' + repoPath);

    /* This is the actual rendering function, which returns a promise. */
    return function (objectId) {
        return new Promise ( (resolve) => {
            if (debug) console.log ('actuallyRenderCHM ' + objectId);
            const render = spawn (javaCommand, javaOptions.concat([ '-jar', shaidyMapGen, repoPath, objectId, objectId, 'NO_ZIP' ]),
				  { stdio: 'ignore' });
            render.on('exit', (code, signal) => {
                if (!(code === 0) || signal !== null) {
                    console.log ('. render error code ' + code + ' signal ' + signal + ' rendering chm==' + objectId);
                }
                resolve (code === 0);
            });
        });
    };
})();
