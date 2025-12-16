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

const debug = false;

const managers = getManagers();

const storage = require('./storage');
const cache = require('./cache');
const routeUtils = require('./route-utils');
const authenticate = require('./shaidy-authenticate').shaidyAuthenticator;
const publicNames = require('./publicnames');
const locks = require('./locks');

// Minimum age (in milliseconds) of an unreachable object before
// it can be flushed by deepclean:
const gracePeriod = 60 * 60 * 1000; // 1 hour

/** Express middleware that validates that the user is a manager.  If
 * the user is a manager, control is passed to the next middleware.
 * Otherwise, a 403 response is sent.
 * - Prerequisite: The user has been authenticated.
 *
 * @function isManager
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
function isManager( req, res, next ) {
    if (debug) console.log ('Check manager: ' + req.user.mail);
    if (req.user.mail && managers.indexOf( req.user.mail ) >= 0) {
      console.log (req.user.mail + ' is a manager');
      next();
    } else {
      console.log (req.user.mail + ' is not a manager');
      res.status(403).send();
    }
}

/** Determine the list of system managers from the environment variable MANAGER_EMAIL.
 *
 * Multiple emails can be specified, separated by commas.
 * All emails are trimmed of white space and converted to lower case.
 */
function getManagers () {
    const emails = process.env.MANAGER_EMAIL;
    console.log ('MANAGER_EMAIL is ' + emails);
    return emails ? emails.split(',').map((x)=>x.trim().toLowerCase()) : [];
}


exports.defineManagerRoutes = function (app) {
    /** Determine if authenticated user is a manager
     * @name Verify Manager
     * @route {GET} /api/manager
     * @authentication Authentication as a manager required.
     */
    app.get('/api/manager', authenticate, routeUtils.checkmail, isManager, function(req, res) {
      res.send({text: "You have manager access. Unauthorized users cannot see this message."});
    });

    /** Return the number of objects of type :type on the server as a JSON object:
     * ```javascript
     * { 'data': number }
     * ```
     * <p></p>
     * @name Count Objects
     * @route {GET} /api/manager/count/:type
     * @authentication Authentication as a manager required.
     */
    app.get('/api/manager/count/:type', authenticate, routeUtils.checkmail, isManager, function(req, res) {
      storage.listSubobjects( req.objectPath, (err, subobjects) => {
	if (err) {
	  res.status(500).send( 'count ' + req.typeName + ' failed' );
	} else {
	  res.status(200).json( { 'data': subobjects.length } );
	}
      });
    });

    /** Return summary of resources accessible to users.
     * @name Deep Scan
     * @route {GET} /api/manager/deepscan
     * @authentication Authentication as a manager required.
     */
    app.get('/api/manager/deepscan', authenticate, routeUtils.checkmail, isManager,
      listUsers,
      function(req, res, next) {
	req.userList.push( 'public' );
	next();
      },
      scanUsers,
      scanPublicObjects,
      function(req, res) {
	if (debug) console.log ('Deepscan: completed - converting results');
	req.scanTable = req.scanTable.map( (x) => {
	  x.chms = (x.chms || []).length;
	  x.collections = (x.collections || []).length;
	  return x;
	} );
	res.status(200).json( { data: req.scanTable } );
      }
    );

    /** Find and remove inaccessible resources
     * @name Deep Clean
     * @route {GET} /api/manager/deepclean
     * @authentication Authentication as a manager required.
     */
    app.get('/api/manager/deepclean', authenticate, routeUtils.checkmail, isManager,
      // FIXME: this api modifies DB. should not be get!!
      function(req, res, next) {
	req.recently = Date.now() - gracePeriod;
	locks.getManagerLock( () => next() );
      },
      enumerateObjects.bind( undefined, 'compendium' ),
      enumerateObjects.bind( undefined, 'collection' ),
      enumerateObjects.bind( undefined, 'chm' ),
      enumerateObjects.bind( undefined, 'viewer' ),
      enumerateObjects.bind( undefined, 'dataset' ),
      enumerateObjects.bind( undefined, 'dendrogram' ),
      enumerateObjects.bind( undefined, 'file' ),
      enumerateObjects.bind( undefined, 'label' ),
      listUsers,
      function(req, res, next) {
	req.userList.push( 'public' );
	next();
      },
      scanUsers,
      scanPublicObjects,
      function(req, res, next) { locks.releaseManagerLock(); next(); },
      // Release NG-CHMs and collections that cannot be reached by any user.
      findUnreachableMapsAndCollections,
      removeOldObjects.bind( undefined, 'collection' ),
      removeOldObjects.bind( undefined, 'chm' ),
      removeOldObjects.bind( undefined, 'viewer' ),
      // Release unreachable leaf objects
      findUnreachableLeafObjects,
      removeOldObjects.bind( undefined, 'dataset' ),
      removeOldObjects.bind( undefined, 'dendrogram' ),
      removeOldObjects.bind( undefined, 'file' ),
      removeOldObjects.bind( undefined, 'label' ),
      function(req, res, next) { // eslint-disable-line no-unused-vars
	res.status(200).send();
      }
    );

    console.log ('Defined manager routes');
};

/** Scan all collections in a DAG of collections.
 * For each collection in the DAG, nodefn is called once
 * in an unspecified order.
 * If the nodefn ever passes back a truthy value of err when resuming the scan,
 * the scan is immediately aborted and donefn is called with that value of
 * err and the corresponding result value.
 * If err is never truthy, donefn is called after all collections
 * in the DAG have been scanned. err will be null, and the value
 * of result will be the value that was passed to the last call to resume scan.
 * @function
 * @param {ProcessNodeFn} nodefn is called once for each collection in the DAG.
 * @param {Any} result is initial value of result passed to nodefn.
 * @param {Array} srcvec is a vector of the 'root' collections in the DAG.
 * @param {ExpressRequest} req is the express request object.
 * @param {ExpressResponse} res is express response object
 * @param {ScanDoneFn} donefn is called after all collections in the DAG
 *           have been processed, or after an error.
 */
function scanDAG (nodefn, result, srcvec, req, res, donefn) {

  // result: results accumulated before this call
  // srcvec: vector of new collection ids to visit
  // seenvec: vector of collection ids we have already seen
  // todovec: vector of collection ids we have yet to scan
  function scanvec (result, srcvec, seenvec, todovec) {
    // Only need to check collections we have not already encountered
    srcvec = srcvec.filter ((id) => { return seenvec.indexOf( id ) < 0 });
    // Catch duplicates within srcvec
    srcvec = Array.from( new Set( srcvec ));
    // We have now 'seen' all collections in srcvec:
    seenvec = seenvec.concat( srcvec );
    // but we still need to check their contents:
    todovec = srcvec.concat( todovec );

    // Call donefn after all nodes have been checked.
    if (todovec.length === 0) {
      donefn( null, result );
      return;
    }

    // Call nodefn for first collection we still need to check
    nodefn( result, todovec[0], (err, result) => {
      if (err) {
        // Call donefn immediately on error
        donefn( err, result );
      } else {
        // Scan children of current collection
        req.srcCollectPath = storage.getObjectPath('collection', todovec[0]).json('collections');
        routeUtils.getJSONVector( 'srcCollect', 'srcCollectPath', req, res, () => {
          scanvec( result, req.srcCollect, seenvec, todovec.slice(1) );
        } );
      }
    } );
  }

  scanvec( result, srcvec, [], [] )
}
/**
 * A ProcessNodeFn is called for each collection in a DAG of collections.
 * @callback ProcessNodeFn
 * @param {Any} result is the result accumulated prior to this call.
 * @param {String} collectionid is the id of this collection.
 * @param {ResumeScanFn} resumeScan is the function to call after processing this collection.
 */

/**
 * A ResumeScanFn is called from a ProcessNodeFn to resume scanning the DAG of collections.
 * @callback ResumeScanFn
 * @param {Error} err is an error, which, iff truthy, aborts scanning of the DAG.
 * @param {Any} result is the result after processing this collection.
 */

/**
 * A ScanDoneFn is called after scanDAG has completed.
 * @callback ScanDoneFn
 * @param {Error} err is an error value or null.
 * @param {Any} result is the final value of result.
 */

/** Find all chms and collections accessible by user.
 * Pseudo-user "public" is accepted as a special case.
 * @function
 * @param {String} user is the id (mail address) of user to scan.
 * @param {ExpressRequest} req is the express request object.
 * @param {ExpressResponse} res is the express response object.
 * @param {UserDoneFn} donefn is the function to call with the scan results.
 */
function scanOneUser (user, req, res, donefn) {

  function scanOneBox (boxList, boxResult) {
    if (boxList.length === 0) {
      // Eliminate duplicates from different boxes.
      boxResult.chms = Array.from(new Set(boxResult.chms));
      boxResult.collections = Array.from(new Set(boxResult.collections));
      donefn( boxResult );
    } else {
        let boxpath = storage.getSpecialCollection (user, boxList[0]);
        req.srcChmPath = boxpath.json("chms");
        routeUtils.getJSONVector ('srcChm', 'srcChmPath', req, res, () => {
          req.srcCollectPath = boxpath.json("collections");
          boxResult.chms = boxResult.chms.concat( req.srcChm );
          routeUtils.getJSONVector ('srcCollect', 'srcCollectPath', req, res, () => {
            scanDAG(
              (result, nodeId, resumeScan) => {
                req.nodeChmPath = storage.getObjectPath('collection', nodeId).json("chms");
                routeUtils.getJSONVector( 'nodeChms', 'nodeChmPath', req, res, () => {
                  resumeScan( null, { collections: result.collections.concat([nodeId]), chms: result.chms.concat(req.nodeChms) } );
                } );
              },
              boxResult,
              req.srcCollect,
              req, res,
              (err, result) => {
                // Ignore errors in any individual box.
                scanOneBox( boxList.slice(1), result );
              }
              );
          });
        });
    }
  }

  const iBoxList = [ "", "clipboard", "mailbox", "trash" ];
  const iBoxResult = { collections: [], chms: [] };
  scanOneBox( iBoxList, iBoxResult );
}
/**
 * A UserDoneFn is called after scanning a user, with one parameter:
 * ```javascript
 * donefn( {
 *   'collections': [ collection.identifiers ],
 *   'chms': [ NG-CHM.identifiers ]
 * } )
 * ```
 * @callback UserDoneFn
 */

/** Express middleware that scans users in req.userList and
 * creates req.scanTable containing a vector of scan results.
 * Each scan result is an object containing:
 * - user: id of user concerned
 * - collections: number of collections user can access
 * - chms: number of NG-CHMs user can access
 * @function
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
function scanUsers (req, res, next) {

  function scanNext (userList) {
    if (userList.length === 0) {
      if (debug) console.log ('scanUsers: finished');
      next();
    } else {
      const user = userList.shift();
      if (debug) console.log ('scanUsers: scanning ' + user);
      scanOneUser( user, req, res, (scanResult) => {
        req.scanTable.push({ user, collections: scanResult.collections, chms: scanResult.chms });
        setImmediate (() => scanNext( userList ));
      });
    }
  }

  if (debug) console.log('scanUsers: ' + req.userList.join(', '));
  req.lockedPaths = [];
  req.scanTable = [];
  scanNext( req.userList );
}

function scanPublicObjects (req, res, next) {

    function scanType (type) {
        return publicNames.listPublicIds(storage.getTypeAccessor(type))
        .then(ids => {
            // FIXME: Need to deep scan ids.
            const fname = type + 's';
            const e = { user: 'public ' + fname };
            e[fname] = ids;
            if (debug) console.log ({ m: 'scanPublicObjects', fname, e });
            req.scanTable.push(e);
            return true;
        });
    }

    Promise.all(storage.listTypes().map(type => scanType(type)))
    .then( () => {
        if (debug) console.log ('scanPublicObjects completed');
        next();
    });
}

/** Express middleware that sets req.userList to a vector containing ids for all users.
 * @function
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
function listUsers( req, res, next) {
    storage.listUsers()
    .then( users => {
        req.userList = users;
        next();
    })
    .catch( err => {
        res.status(500).send( 'unable to list users' );
        console.log('Unable to list users:');
        console.error(err);
    });
}

/** Express middleware that enumerates all objects of type typeName and stores
 * them in req.enumerated[typeName].
 * @function
 * @param {String} typeName is the name of the request field containing the type of the objects to enumerate.
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
function enumerateObjects(typeName, req, res, next) {
  if (!storage.isValidType( typeName )) {
    console.log( 'enumerateObjects: bad typeName: ' + typeName );
    res.status(500).send();
  }
  storage.listSubobjects( storage.getTypeAccessor(typeName), (err, subobjects) => {
    if (err) {
      console.log( 'Deepclean: cannot enumerate ' + typeName + 's: err=' + err );
      res.status(500).send();
    } else {
      req.enumerated = req.enumerated || {};
      req.enumerated[typeName] = subobjects;
      next();
    }
  });
}

/** Express middleware that removes any objects contained in req.enumerated[typeName] that were
 * created before req.recently.
 * NOTE: objects to be removed must not be reachable from any public
 * or user collection.  This function does not verify that.
 * @function
 * @param {String} typeName is the name of the request field containing the type of the enumerated objects to remove.
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
function removeOldObjects(typeName, req, res, next) {
  if (!req.enumerated.hasOwnProperty( typeName )) {
    console.log( 'removeOldObjects: bad typeName: ' + typeName );
    res.status(500).send();
  }
  storage.removeOldObjects (storage.getTypeAccessor(typeName), req.enumerated[typeName], req.recently, next);
}

/** Find ids of all shaids of type typeName in an NG-CHM object
 * @function
 * @param {String} typeName is the type of the shaids to look for.
 * @param {Object} ngchm is an NG-CHM object.
 * @returns {Array}
 */
function findShaids (typeName, ngchm) {

  let result = new Set();

  function fn (o) {
    if (o && typeof(o)==='object') {
      if (o.hasOwnProperty('class') && o.class==='shaid') {
        if (o.type===typeName) result.add( o.value );
      } else for (let oo in o) {
        if (o.hasOwnProperty(oo)) fn (o[oo]);
      }
    }
  }

  fn (ngchm);
  return Array.from(result);
}

/* Find maps and collections that cannot be reached from the roots of the repository DAG.
 */
function findUnreachableMapsAndCollections (req, res, next) {
    // Initialize unchms, uncollections, and unviewers to all maps and collections
    // found in the repository.
    // Remove the public collection and any user collections (we want to keep them).
    let unchms = new Set(req.enumerated.chm);
    let uncollections = new Set(storage.removeUserCollections (req.enumerated.collection));
    uncollections.delete( 'public' );
    let unviewers = new Set(req.enumerated.viewer);
    // Initialize reachChms to the empty set.
    let reachChms = new Set();
    // Traverse the user scan table.  For each user, remove any maps or collections they
    // can reach from the sets of unreachable objects.  Add reachable maps to reachChms.
    req.scanTable = req.scanTable.forEach( (x) => {
      (x.chms||[]).forEach((chm) => {
	unchms.delete(chm);
	unviewers.delete(chm);
	reachChms.add(chm);
      });
      (x.collections||[]).forEach((collection) => { uncollections.delete(collection); });
    } );
    // Converted the unreachable sets and the reachable chms into arrays and
    // store them in the request.
    req.enumerated.chm = Array.from(unchms);
    req.enumerated.collection = Array.from(uncollections);
    req.enumerated.viewer = Array.from(unviewers);
    req.reachChms = Array.from(reachChms);
    if (debug) outputTrace();
    next();

    function outputTrace () {
	console.log( 'Found ' + req.enumerated.chm.length + ' unreachable chms: ' + req.enumerated.chm.join(','));
	console.log( 'Found ' + req.enumerated.viewer.length + ' unreachable viewers: ' + req.enumerated.viewer.join(','));
	console.log( 'Found ' + req.enumerated.collection.length + ' unreachable collections: ' + req.enumerated.collection.join(','));
	console.log( 'Found ' + req.reachChms.length + ' reachable chms: ' + req.reachChms.join(','));
    }
}

// Find leaf objects that are unreachable from any reachable chm.
//
// Leaf objects are one of the following types: dataset, dendrogram, file, and label.
// They cannot refer to any other objects so we don't need to scan them.
//
// Leaf objects are only referenced by chms.  So to find reachable leaf objects,
// we have to scan the chm.json files of all reachable NG-CHMs.
function findUnreachableLeafObjects (req, res, next) {
    // Initialize the "un sets" to all leaf objects in the repository.
    const undatasets = new Set(req.enumerated.dataset);
    const undendrograms = new Set(req.enumerated.dendrogram);
    const unfiles = new Set(req.enumerated.file);
    const unlabels = new Set(req.enumerated.label);
    // Scan each reachable chm.
    checkChm( req.reachChms );

    function checkChm (chms) {
      if (chms.length===0) {
	// No chms left to scan.  Convert remaining unreachable leaf objects into
	// arrays and store them in the request.
	req.enumerated.dataset = Array.from( undatasets );
	req.enumerated.dendrogram = Array.from( undendrograms );
	req.enumerated.file = Array.from( unfiles );
	req.enumerated.label = Array.from( unlabels );
	if (debug) outputTrace ();
	next();
      } else {
	// Remove any leaf objects referenced by the chm.
	const chm = chms.shift();
	cache.getObject (storage.getObjectPath('chm', chm).json("chm"))
	.then(props => {
	    findShaids( 'dataset', props).forEach((id) => undatasets.delete( id ));
	    findShaids( 'dendrogram', props).forEach((id) => undendrograms.delete( id ));
	    findShaids( 'file', props).forEach((id) => unfiles.delete( id ));
	    findShaids( 'label', props).forEach((id) => unlabels.delete( id ));
	    setImmediate (() => checkChm( chms ));
	})
	.catch(err => {
	    console.log( 'Error scanning chm/' + chm );
	    console.error (err);
	    res.status(500).send('error scanning chm')
	});
      }
    }

    function outputTrace () {
	console.log( 'Found ' + req.enumerated.dataset.length + ' unreachable datasets: ' + req.enumerated.dataset.join(','));
	console.log( 'Found ' + req.enumerated.dendrogram.length + ' unreachable dendrograms: ' + req.enumerated.dendrogram.join(','));
	console.log( 'Found ' + req.enumerated.file.length + ' unreachable files: ' + req.enumerated.file.join(','));
	console.log( 'Found ' + req.enumerated.label.length + ' unreachable labels: ' + req.enumerated.label.join(','));
    }
}
