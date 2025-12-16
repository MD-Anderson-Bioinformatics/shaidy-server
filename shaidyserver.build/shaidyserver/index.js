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

/*global console*/
/*global process*/
/*eslint security/detect-non-literal-fs-filename: "off" */
/*eslint security/detect-object-injection: "off" */

/** Express router implementing the shaidyserver protocol.
 * @module shaidyserver
 */
const storage = require('./storage');
const express = require('express');
const cors = require('cors');
const app = express();
const publicnames = require('./publicnames');
const logger = require('./logger');

if (process.env.NODE_ENV === 'production') {
    app.disable('x-powered-by');
}
logger.info(`Server configured for: ${process.env.NODE_ENV}`);

if ((process.env.SHAIDY_ACCESS_MODE || "READ-ONLY") !== "READ-WRITE") {
    logger.warn('Shaidy server is READ ONLY');
    app.all('*', function (req, res, next) {
        if (req.method === 'POST' && req.params[0] === '/api/ZippedMap') {
            // whitelist request to save zipped map: does not modify database.
            // uploaded data is incorporated into the downloaded zip file.
            next();
        } else if (req.method !== 'GET' && req.method !== 'HEAD') {
            // Block all other modification access points.
            logger.warn('Forbidden RW request: ' + req.method + ' ' + req.protocol + '://' + req.hostname + req.originalUrl + ' from ' + req.ip + ' (' + req.ips.join(', ') + ')');
            res.status(403).send('read only server');
        } else {
            next();
        }
    });
}

const bodyParser = require('body-parser');
const jsonParser = bodyParser.json();
const urlEncoded = bodyParser.urlencoded({ extended: false });
const routeUtils = require('./route-utils');
const managers = require('./managers');

const authenticate = require('./shaidy-authenticate').shaidyAuthenticator;
const locks = require('./locks');
const debug = false;

const cache = require('./cache');
const dataAccessServices = require('./data-access-services');


app.use(cors());

/* Send (a subset of) the authenticators accepted by the shaidy server.
 */
app.get('/api/authenticators', function (req, res) {
    const auth = require('./shaidy-authenticate').getShaidyAuthenticators();
    res.status(200).json(auth);
});

/** List available protocols (shaidy)
 * @name List Protocols
 * @route {GET} /api
 * @authentication Not required.
 */
app.get('/api', function(req, res) {
  res.json({'protocols': [ "shaidy"]});
});

/** Determine if server is running
 * @name Ping Server
 * @route {GET} /api/ping
 * @authentication Not required.
 */
app.get('/api/ping', function(req, res) {
  res.send({text: "You have contacted the server. You do not need to be authenticated to do this."});
});

/** Determine if user is authenticated
 * @name Verify Authenticated Access
 * @route {GET} /api/secured/ping
 * @authentication Required
 */
app.get('/api/secured/ping', authenticate, routeUtils.checkmail, function(req, res) {
  res.send({text: "You have verified that you have authenticated access to the server. Unauthenticated users cannot see this message."});
});

/** Return security token as text
 * @name Get Security Token
 * @route {GET} /api/secured/token
 * @authentication Required
 */
app.get('/api/secured/token', authenticate, routeUtils.checkmail, function(req,res) {
  res.send({text: req.get('Authorization')});
});

/** Return accepted shaidy object types as a JSON object:
 * ```javascript
 * { 'data': [ string ] }
 * ```
 * <p></p>
 * @name Get Types
 * @route {GET} /api/types
 * @authentication Not required
 */
app.get ('/api/types', function (req, res) {
  res.json ({'data': storage.listTypes()});
});



// ##################################################################################################################
const fs = require('fs-extra');
const spawn = require('child_process').spawn; // eslint-disable-line security/detect-child-process

function badName (str) {
   return !str || str==='..' || str.indexOf(storage.pathSeparator) >= 0;
}

/** Express middleware that loads an NG-CHM's viewer heatmapProperties.
 * If the heatmapProperties file cannot be accessed, a 400 or 404 response
 * is sent.  Otherwise, the mapPath and heatmapProperties are set on the
 * request object and control is passed to the next middleware.
 *
 * @function
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
function getViewer (req, res, next) {
  if (badName( req.query.map )) {
    res.status(400).send('bad request');
    return;
  }
  req.objectPath = storage.getObjectPath('viewer', req.query.map);
  cache.getObject (req.objectPath.json('heatmapProperties'))
  .then(data => {
      req.heatmapProperties = data;
      req.mapPath = req.objectPath.object(req.heatmapProperties.chm_name);
      next ();
  })
  .catch (err => {
      if (debug) console.log ('Cannot get heatmap properties for map ' + req.query.map);
      if (debug) console.error (err);
      res.status(404).send('map not found');
  });
}

/** Return an NG-CHM Viewer Descriptor
 * @name Get Descriptor
 * @route {GET} /GetDescriptor
 * @authentication Not required.
 * @queryparam {String} map is the unique map identifier
 * @queryparam {String} type is the type of descriptor to return
 */
app.get ('/api/GetDescriptor', getViewer, function (req, res) {
  if (badName( req.query.type )) {
    res.status(400).send('bad request');
    return;
  }
  const path = req.mapPath.json(req.query.type);
  if (debug) console.log ('GetDescriptor: path == ' + path);
  if (req.query.type === 'mapConfig') {
    cache.getObject (path)
    .then(data => {
        if (data.data_configuration && data.data_configuration.map_information) {
            const mapinfo = data.data_configuration.map_information;
            mapinfo.read_only = 'Y';
            const directURL = storage.getDirectURL ('viewer/' + req.query.map + '/' + mapinfo.name + '/');
            if (directURL) {
                mapinfo.layerURLs = {};
                for (let dl in mapinfo.data_layer) {
                    mapinfo.layerURLs[dl] = directURL + dl + '/--LEVEL--/--TILE--.tile';
                }
            }
        };
        res.status(200).json(data);
    })
    .catch(err => {
      console.log( 'Error fetching mapConfig: map==' + req.query.map );
      console.error( err );
      res.status(500).send('internal error');
    });
  } else {
    storage.sendFile (res, path, function (err) {
      if (err) {
        console.log( 'SendFile error in GetDescriptor: map==' + req.query.map + ", type==" + req.query.type );
        console.error( err );
        res.status(404).send('error sending descriptor');
      }
    });
  }
});

/** Return an NG-CHM Viewer tile
 * @name Get Tile
 * @route {GET} /GetTile
 * @authentication Not required.
 * @queryparam {String} map is the unique map identifier
 * @queryparam {String} datalayer is the layer containing the tile
 * @queryparam {String} level is the level of tile
 * @queryparam {String} tile is the identity of the specific tile
 */
app.get ('/api/GetTile', getViewer,
  function (req, res, next) {
    /* Validate tile request and set req.tilepath */
    if (badName( req.query.datalayer ) || badName( req.query.level ) || badName( req.query.tile )) {
      res.status(400).send('bad request');
      return;
    }
    req.tilepath = req.mapPath.file(req.query.datalayer + storage.pathSeparator + req.query.level + storage.pathSeparator + req.query.tile);
    next();
  },
  storage.selectTile,
  function (req, res) {
    storage.sendFile (res, req.tilepath, function (err) {
      if (err) {
	console.log( 'Sendfile error in GetTile: map==' + req.query.map + ", datalayer==" + req.query.datalayer );
	console.error( err );
	res.status(404).send('error sending tile');
      }
    });
  }
);

/** Return an NG-CHM zipped map
 * @name Zipped Map
 * @route {POST} /ZippedMap
 * @authentication Not required.
 * @queryparam {String} map is the unique map identifier
 * @bodyparam {Object} configData is the map configuration data
 */
app.post( '/api/ZippedMap', getViewer, bodyParser.urlencoded({ extended: false }),
  // Create a local temporary directory in which to create a temporary image
  // of the chm's viewer directory.  Let's call it /req.tmpDir
  function( req, res, next ) {
    if (debug) console.log ('ZippedMap');
    if (debug) console.log (JSON.stringify(req.body));
    if (badName( req.query.map )) {
      res.status(400).send('bad request');
      return;
    }
    if (req.body.configData===undefined) {
      res.status(400).send('configData undefined');
      return;
    }
    // We will eventually localize the object so we can add its
    // contents to the zip.
    fs.mkdtemp( '/tmp/' + req.query.map + '---', (err, tmpObjectPath) => {
      if (err) {
        res.status(500).send('cannot create zip')
      } else {
        req.tmpDir = tmpObjectPath;
        // Sanitize bad chm names
        req.chmName = req.heatmapProperties.chm_name.replace( /\//g, '.' );
        if (req.chmName[0] === '.') req.chmName = 'x' + req.chmName;
        next();
      }
    });
  },
  // Create a directory for the NGCHM's image.
  // Let's call it /req.tmpDir/req.chmName
  function( req, res, next ) {
    req.tmpZipDir = req.tmpDir + '/' + req.chmName;
    fs.mkdir( req.tmpZipDir, (err) => {
      if (err) {
        console.log ('cannot create tmpZipDir ' + req.tmpZipDir);
        res.status(500).send('cannot create zip');
        spawn( '/bin/rm', [ '-rf', req.tmpDir ] );
      } else {
        next();
      }
    });
  },
  // Clean up the mapConfig.json sent by the client and save
  // it as /req.tmpDir/req.chmName/mapConfig.json
  function( req, res, next ) {
    fs.writeFile( req.tmpZipDir + '/mapConfig.json', req.body.configData, (err) => {
      if (err) {
        console.log( 'Error writing ' + req.tmpZipDir + '/mapConfig.json err==' + err);
        res.status(500).send('cannot create zip');
        spawn( '/bin/rm', [ '-rf', req.tmpDir ] );
      } else {
        next();
      }
    });
  },
  // Create a local copy of the chm and all its support files, if needed.
  storage.localizeObject,
  // In the heatmap image create symbolic links to all files/directories in
  // the chm, except for:
  // - the client's mapConfig.json file (the client's file is already there), and
  // - any other support files that don't belong in the ZippedMap.
  function( req, res, next ) {
    if (debug) console.log ({ m: 'Object localized at', localObject: req.objectPath });
    const srcdir = req.objectPath.path + '/' + req.chmName + '/';
    // Read the CHM directory to determine all top-level files/directories:
    fs.readdir(srcdir, function(err, items) {
	if (err) {
	    doerror ();
	} else {
            if (debug) console.log({ m: 'items to zip', items });
	    link1 (items.filter( xx => xx !== 'directURLs.json' && xx !== 'mapConfig.json'));
	}
    });

    // Create a symbolic link for each file/directory.  After all links
    // have been created, go to next step to start zipping.
    function link1 (items) {
	if (items.length === 0) {
	    next ();
	} else {
	    const name  = items.shift();
	    if (debug) console.log ({ m:'creating symlink for', name });
	    fs.symlink ( srcdir + name, req.tmpZipDir + '/' + name,
		         (err) => {
	        if (err) {
		    doerror();
		} else {
		    setImmediate (() => link1 (items));
		}
	    });
        }
    }

    function doerror (err) {
	// Notify client of error and remove localized object and tmpdir.
	res.status(500).send('cannot create zip');
	storage.freeLocalizedObject(req);
	spawn( '/bin/rm', [ '-rf', req.tmpDir ] );
    }
  },
  // Create a zip process to create the ZippedMap.
  //
  // The zip is spawned in the temporary image directory, created above, which contains the user's
  // mapConfig.json and symbolic links to all other desired files/directories in the chm.  The zip
  // follows the symbolic links and recurses (-r option) into the directories adding all desired
  // content to the zip file.
  //
  // The zip process writes the created zip file to its standard output, which will be fed directly into
  // the response socket.  Before that connection is made, the response status and other headers will be
  // written to the response socket.
  //
  // Besides recursive (-r), the other zip options are quiet (-q) and maximum compression (-9).
  // The spawn option stdio configures the zip process's standard file descriptors as follow:
  // - 'ignore' sets the child process's stdin to /dev/null,
  // - 'pipe' sets the child process's stdout to a pipe to this process, and
  // - process.stderr shares this process's stderr with the child process's stderr.
  //
  // The stdout pipe back from the child will be connected to the responses' socket
  // once the response headers have been output.
  function( req, res, next ) {
    const childp = spawn( 'zip', [ '-r9q', '-', req.chmName ], { cwd: req.tmpDir, stdio: [ 'ignore', 'pipe', process.stderr ] } );
    if (debug) console.log ({ m: 'Spawn childp', childp });
    // Set and send the response headers:
    res.status(200);
    res.setHeader('Content-Type', 'application/ngchm');
    res.setHeader("Content-Disposition", "attachment; filename=\"" + req.chmName +".ngchm\"");
    res.flushHeaders();
    // Connect the stdout of zip to the response socket:
    childp.stdout.pipe (res.socket);
    // Clean up when the zip has terminated:
    childp.on('close', (code) => {
	if (debug) console.log ('Zip finished: code == ' + code);
	if (code !== 0) {
	  // There was an error before the zip finished,
	  // nothing we can really do about it now.
	  console.log ({ m: 'Error zipping map contents ', objectPath, ErrorCode: code });
	}
	// Remove localized storage and tmpdir.
	storage.freeLocalizedObject(req);
	spawn( '/bin/rm', [ '-rf', req.tmpDir ] );
    });
  }
);

// ##################################################################################################################

const shaidy = require('./shaidy');
const publicNames = require('./publicnames');

app.param ('type', function (req, res, next, typeName) {
    //console.log ('param(type) typeName=' + typeName);
    if (storage.isValidType (typeName)) {
        req.typeName = typeName;
        req.objectPath = storage.getTypeAccessor(typeName); // eslint-disable-line security/detect-object-injection
        next ();
    } else {
        console.log ('param(type) typeName ' + typeName + ' is not valid' );
        next ('route');
    }
})

app.param ('objid', function (req, res, next, id) {
  //console.log ('param(objid) objid=' + id);
  if (id === '..' || id === '.') {
    res.status(400).send('bad request');
    return;
  }
  publicNames.mapPublicId (req, res, id, function() {
      req.objectValid = undefined;
      next();
  });
});

/** Express middleware (after binding collectName) that sets req[collectName] to the
 * objectPath for the collection in req.params[collectName].
 * Collections with special predefined names (clipboard, mailbox, trash, home, and
 * the empty string) are interpreted relative
 * to the user's home collection, and are created on the fly if needed.
 * All other collections must already exist.
 *
 * @function
 * @param {String} collectName  Name of the collection parameter
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
function setCollection (collectName, req, res, next) {
  const id = req.params[collectName];
  //console.log ('setCollection collectName==' + collectName + ", id==" + id);
  if (id === '..') {
    res.status(400).send('bad request');
    return;
  }
  req[collectName] = storage.getSpecialCollection(req.user.mail, id);
  if (req[collectName]) {
      storage.makeObjectIfNeeded (req[collectName], next);
  } else if (storage.isValidType ('collection')) {
      req[collectName] = storage.getTypeAccessor('collection').object(id);
      cache.objectExists (req[collectName])
      .then( exists => {
        if ( exists ) {
          next();
        } else {
          res.status(404).send( 'collection not found' );
        }
      });
  }
  else {
    res.status(404).send( 'collection not found' );
  }
}

/** Express middleware (after binding compendName) that sets req[compendName] to the
 * objectPath for the compendium in req.params[compendName].
 * The compendium must already exist.
 *
 * @function
 * @param {String} compendName  Name of the compendium parameter
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
function setCompendium (compendName, req, res, next) {
  let id = req.params[compendName];
  //console.log ('setCompendium compendName==' + compendName + ", id==" + id);
  if (id === '..') {
    res.status(400).send('bad request');
    return;
  }
  if (storage.isValidType ('compendium')) {
    req[compendName] = storage.getObjectPath('compendium', id);
    cache.objectExists (req[compendName])
    .then (function (exists) {
      if ( exists ) {
        next();
      } else {
        res.status(404).send( 'compendium not found' );
      }
    });
  }
  else {
    res.status(404).send( 'compendium not found' );
  }
}

app.param ('prop', function (req, res, next, propName) {
    req.propName = propName;
    next();
})

app.param ('searchstr', function (req, res, next, searchStr) {
    req.searchStr = searchStr;
    next();
})

app.param ('user', function (req, res, next, userStr) {
    if (userStr === '..') {
      res.status(400).send('bad request');
      return;
    }
    req.userStr = userStr;
    next();
})

/**
 * Express middleware (after binding name) that sets req.objectPath to the path
 * to the user's named collection.
 * - Prerequisite: isCollection, authenticated, userRoot
 * @function
 * @param {String} name is the name of the named collection.
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
function namedUserCollection( name, req, res, next ) {
    req.objectPath = storage.getSpecialCollection (req.user.mail, name);
    if (!req.objectPath) {
      console.log( 'Error: named collection "' + name + '" is not valid' );
      res.status(404).send('not found');
      return;
    }
    req.objectValid = true;
    storage.makeObjectIfNeeded (req.objectPath, next);
}

/** Express middleware that sets req.objectPath to the mailbox of req.userStr.
 * - Prerequisite: isCollection, authenticated.
 * - Prerequisite: req.userStr is already in the system.
 * @function
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
function sendmailCollection( req, res, next ) {
    req.objectPath = storage.getSpecialCollection(req.userStr, 'mailbox');
    req.objectValid = true;
    storage.makeObjectIfNeeded (req.objectPath, next);
}

/** Return properties of type :prop from the user's root collection.
 * @name Get Collection Properties
 * @route {GET} /api/prop/:prop/collection
 * @authentication Required
 * @routeparam {String} prop is the name of the properties object to return
 */
// :type must be collection.
app.get ('/api/prop/:prop/:type', routeUtils.isCollection, authenticate, routeUtils.checkmail, routeUtils.userRoot, routeUtils.propertyPath, routeUtils.sendObjectAsJSON);

/** Return properties of type :prop from a user's named collection.
 * @name Get Collection Properties
 * @route {GET} /api/prop/:prop/collection/:name
 * @authentication Required
 * @routeparam {String} prop is the name of the properties object to return
 * @routeparam {String} name is the name of a user's named collection (must be clipboard, mailbox, or trash)
 */
app.get ('/api/prop/:prop/:type/clipboard', routeUtils.isCollection, authenticate, routeUtils.checkmail,
  namedUserCollection.bind( undefined, 'clipboard'), routeUtils.propertyPath, routeUtils.sendObjectAsJSON);
app.get ('/api/prop/:prop/:type/mailbox', routeUtils.isCollection, authenticate, routeUtils.checkmail,
  namedUserCollection.bind( undefined, 'mailbox' ), routeUtils.propertyPath, routeUtils.sendObjectAsJSON);
app.get ('/api/prop/:prop/:type/trash', routeUtils.isCollection, authenticate, routeUtils.checkmail,
  namedUserCollection.bind( undefined, 'trash' ), routeUtils.propertyPath, routeUtils.sendObjectAsJSON);

/** Return properties of type :prop from object (:type,:objid)
 * @name Get Object Properties
 * @route {GET} /api/prop/:prop/:type/:objid
 * @authentication Not required
 * @routeparam {String} prop is the name of the properties object to return
 * @routeparam {String} type is the type of the object being queried
 * @routeparam {String} objid is the uuid of the object being queried
 */
app.get ('/api/prop/:prop/:type/:objid', routeUtils.objectExists, routeUtils.propertyPath, routeUtils.sendObjectAsJSON);

/** Check write permission for object (collection,:objectId)
 * @name Check Write Permission
 * @route {GET} /api/canmodify/collection/:objectId
 * @authentication Required
 * @routeparam {String} objectId is the uuid of the collection concerned
 */
app.get ('/api/canmodify/:type/:objectId',
    function( req, res, next ) { if (debug) console.log( 'get permission ' + req.params.type + ' ' + req.params.objectId ); next(); },
    authenticate, routeUtils.checkmail,
    routeUtils.isCollection,
    setCollection.bind( undefined, 'objectId' ),
    routeUtils.hasModifyPermission( 'objectId' ),
    function( req, res, next ) { res.status(200).send('[]') } // eslint-disable-line no-unused-vars
);

/** Check write permission for object (compendium,:objectId)
 * @name Check Write Permission
 * @route {GET} /api/canmodify/compendium/:objectId
 * @authentication Required
 * @routeparam {String} objectId is the uuid of the compendium concerned
 */
app.get ('/api/canmodify/:type/:objectId',
    function( req, res, next ) { if (debug) console.log( 'get permission ' + req.params.type + ' ' + req.params.objectId ); next(); },
    authenticate, routeUtils.checkmail,
    routeUtils.isCompendium,
    setCompendium.bind( undefined, 'objectId' ),
    routeUtils.hasModifyPermission( 'objectId' ),
    function( req, res, next ) { res.status(200).send('[]') } // eslint-disable-line no-unused-vars
);

/** Set properties of type :prop for object (collection,:objid)
 * @name Set Collection Properties
 * @route {PUT} /api/prop/:prop/collection/:objid
 * @authentication Required
 * @bodyparam {Array} labels is a vector containing the property values to set
 * @routeparam {String} prop is the name of the properties object to set
 * @routeparam {String} type is the type of the object being modified === collection
 * @routeparam {String} objid is the uuid of the object being modified
 */
app.put ('/api/prop/:prop/:type/:objid',
    function( req, res, next ) { if (debug) console.log( 'put prop ' + req.params.prop + ' ' + req.params.type + ' ' + req.params.objid ); next(); },
    authenticate, routeUtils.checkmail,
    routeUtils.isCollection,
    routeUtils.objectExists,
    routeUtils.hasModifyPermission( 'objectPath' ),
    jsonParser,
    function( req, res, next ) { req.newLabels = req.body.labels; next(); },
    routeUtils.propertyPath,
    routeUtils.lockReqPaths.bind( undefined, [ "objectPath" ] ),
    saveJSON.bind( undefined, "newLabels", "objectPath" ),
    requestOK
);

/** Set properties of type :prop for object (compendium,:objid)
 * @name Set Compendium Properties
 * @route {PUT} /api/prop/:prop/compendium/:objid
 * @authentication Required
 * @bodyparam {Array} labels is a vector containing the property values to set
 * @routeparam {String} prop is the name of the properties object to set
 * @routeparam {String} type is the type of the object being modified === compendium
 * @routeparam {String} objid is the uuid of the object being modified
 *
 * Special rules apply to updating compendium properties.
 * Once set the mapsCollection cannot be changed.  (To change this, you will need
 * to verify that the change doesn't cause cycles in the collection/compendium graph.)
 */
app.put ('/api/prop/:prop/:type/:objid',
    function( req, res, next ) { if (debug) console.log( 'put prop ' + req.params.prop + ' ' + req.params.type + ' ' + req.params.objid ); next(); },
    authenticate, routeUtils.checkmail,
    routeUtils.isCompendium,
    routeUtils.objectExists,
    routeUtils.hasModifyPermission( 'objectPath' ),
    jsonParser,
    function( req, res, next ) {
      if (req.body.labels) {
        req.newLabels = req.body.labels;
        next();
      } else {
        res.status(400).send( 'invalid update' );
      }
    },
    function( req, res, next ) {
	if (req.newLabels.owner !== req.user.mail) {
                if (debug) console.log ({ m: 'Compendium owner does not match user', user: req.user.mail, newLabels: req.newLabels });
		res.status(403).send();
	} else {
		next();
	}
    },
    routeUtils.propertyPath,
    function( req, res, next ) {
      cache.getObject (req.objectPath)
      .then(data => {
          if (debug) console.log ('data.mapsCollection: ' + data.mapsCollection);
          if (debug) console.log ('req.newLabels.mapsCollection: ' + req.newLabels.mapsCollection);
          if (data.mapsCollection && data.mapsCollection === req.newLabels.mapsCollection) {
            if (debug) console.log ("Maps collections the same, skipping");
            next();
	  } else if (req.newLabels.owner !== data.owner) {
            if (debug) console.log ("Update failed owner check: old owner: " + data.owner + " new owner: " + req.newLabels.owner);
	    res.status(403).send();
	  } else if (req.newLabels.publicName === data.publicName) {
            if (debug) console.log ("Maps public names the same, skipping");
	    next();
	  } else {
	    // Must be last check before actually saving new compendium data.
	    // Ideally, they should be together in a transaction.
	    if (publicnames.changePublicName (req.objectPath, req.newLabels.publicName, data.publicName)) {
              if (debug) console.log ("Maps public name change allowed, skipping");
              next();
            } else {
              if (debug) console.log ("Update failed public name check: old name: " + data.publicName + " new name: " + req.newLabels.publicName);
	      res.status(403).send();
            }
          }
      })
      // TODO: catch still needed after merge?
      .catch(err => {
          console.log( 'error loading property: ' + req.objectPath );
          res.status(500).send( 'error loading property' );
      });
    },
    routeUtils.lockReqPaths.bind( undefined, [ "objectPath" ] ),
    saveJSON.bind( undefined, "newLabels", "objectPath" ),
    requestOK
);

/** Render an NG-CHM.
 * This renders the Shaidy NG-CHM to a viewable NG-CHM.
 * @name Render NG-CHM
 * @route {POST} /api/render/chm/:objid
 * @routeparam {String} :objid is the UUID of the NG-CHM to be rendered
 * @authentication Required
 */
// :type must equal chm
// User must be authenticated, :type must be a CHM, object (chm) must exist.
const renderCHM = require('./renderer').renderCHM;
app.post ('/api/render/:type/:objid',
	authenticate, routeUtils.checkmail, routeUtils.isCHM,
	routeUtils.objectExists, renderCHM);

/** Return contents of a file from (:type, :objid)
 * @name Get File
 * @route {GET} /api/file/:type/:objid/:filename
 * @authentication Not required
 * @routeparam {String} type is the type of the object containing the file
 * @routeparam {String} objid is the uuid of the object containing the file
 * @routeparam {String} filename is the name of the file to get
 */
app.get ('/api/file/:type/:objid/*', routeUtils.objectExists,
  function (req, res, next) { // eslint-disable-line no-unused-vars
    let filename = req.params[0] ? req.params[0] : 'index.html';
    //console.log ('get file: objectPath==' + req.objectPath + ", filename==" + filename);
    if (filename === '..') {
      res.status(400).send('bad request');
      return;
    }
    storage.sendFile (res, req.objectPath.file(filename), function (err) {
      if (err) {
        console.log('sendFile error: ' + err.name + ': ' + err.message);
        try {
          res.status(404).send('sendFile error: ' + err.name + ': ' + err.message);
        } finally {};
      } else {
        //console.log ('sendFile succeeded');
      }
    });
  }
);

/** Create a new collection and return a JSON object
 * containing the uuid of the new collection:
 * ```javascript
 * { 'data': uuid }
 * ```
 * <p></p>
 * @name Create Collection
 * @route {POST} /api/create/collection
 * @bodyparam {Array} labels is a vector of name, value tuples
 * @authentication Required.
 */
app.post ('/api/create/collection', authenticate, routeUtils.checkmail, jsonParser,
  function (req, res, next) { // eslint-disable-line no-unused-vars
    if (debug) console.log ('POST to /api/create/collection : ' + JSON.stringify(req.body));
    if (req.body.labels && req.body.labels.length > 0) {
      const uuid = shaidy.getuuid (JSON.stringify(req.body));
      const objectPath = storage.getObjectPath('collection', uuid);
      if (debug) console.log ('Create collection:');
      if (debug) console.log (objectPath);
      cache.createObjectAndFile( objectPath, 'labels', req.body.labels )
      .then( () => {
          res.status(200).json( { 'data': uuid } );
      })
      .catch((err) => {
          res.status(500).send( 'collection creation failed' );
      });
    } else {
      res.status( 400 ).send( 'label(s) required' );
    }
  }
);

/** Create a new compendium and return a JSON object
 * containing the uuid of the new compendium:
 * ```javascript
 * { 'data': uuid }
 * ```
 * <p></p>
 * @name Create Compendium
 * @route {POST} /api/create/compendium
 * @bodyparam {Object} definition is an object defining the compendium
 * @authentication Required.
 */
app.post ('/api/create/compendium', authenticate, routeUtils.checkmail, jsonParser,
  function (req, res, next) {
    console.log ('POST to /api/create/compendium : ' + JSON.stringify(req.body));
    if (!req.body.definition) {
      res.status( 400 ).json( 'compendium definition required' );
    } else if (!req.body.definition.mapsCollection) {
      res.status( 400 ).json( 'compendium mapsCollection required' );
    } else {
      storage.objectExists (storage.getObjectPath('collection', req.body.definition.mapsCollection))
      .then(function (exists) {
        if (exists) {
          next();
        } else {
          res.status( 400 ).json( 'compendium mapsCollection does not exist' );
        }
      });
    }
  },
  function (req, res, next) { // eslint-disable-line no-unused-vars
    const uuid = shaidy.getuuid (JSON.stringify(req.body));
    const objectPath = storage.getObjectPath('compendium', uuid);
    const newcomp = Object.assign({}, req.body.definition, {
	owner: req.user.mail
    });
    cache.createObjectAndFile (objectPath, 'compendium', newcomp)
    .then( () => {
        res.status(200).json( { 'data': uuid } );
    })
    .catch( (err) => {
        res.status(500).send( 'compendium creation failed' );
    });
  }
);

/** Returns an array containing all user identifiers known to the system:
 * ```javascript
 * { 'data' : users }
 * ```
 * <p></p>
 *
 * @name List All Users
 * @route {GET} /api/search/users
 * @authentication Required
 */
app.get ('/api/search/users', authenticate, routeUtils.checkmail,
  function (req, res, next) { // eslint-disable-line no-unused-vars
    storage.listUsers()
    .then( users => {
        res.status(200).json( { 'data': users } );
    })
    .catch( err => {
        res.status(500).send( 'list users failed' );
        console.log('Error listing users');
        console.error(err);
    });
  }
);

/** Returns an array containing all user identifiers known to the system
 * that contain :searchstr:
 * ```javascript
 * { 'data' : users }
 * ```
 * <p></p>   
 * @name Search Users
 * @route {GET} /api/search/users/:searchstr
 * @authentication Required
 * @routeparam {String} :searchstr String to search for
 */
app.get ('/api/search/users/:searchstr', authenticate, routeUtils.checkmail,
  function (req, res, next) { // eslint-disable-line no-unused-vars
    storage.listUsers( req.searchStr )
    .then(matches => {
        res.status(200).json( { 'data': matches } );
    })
    .catch(err => {
        console.log ('Error listing users');
        console.error (err);
        res.status(500).send( 'list users failed' );
    });
  }
);

/** Express middleware (after binding fileName and objectName) that sets
 * req[fileName] to the filepath for subobjects of type :subtype.
 * - Prerequisite: req[objectName] is set to the path to the parent object
 *
 * @function
 * @param {String} fileName is the name of the request field in which to save the file name.
 * @param {String} objectName is the name of the request field containing the path to the parent object.
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
function setSubtypeFilePath (fileName, objectName, req, res, next) {
    req[fileName] = req[objectName].json((req.params.subtype==='matrix'?'matrice':req.params.subtype) + 's');
    next();
}
const setObjectSubtypeFilePath = setSubtypeFilePath.bind( undefined, 'filePath', 'objectPath' );

/** Express finalware that inserts the subobject (:subtype, :subid) into the parent object
 * - Prerequisite: req.filePath is set to the filepath for :subtype in the parent object
 * - Prerequisite: :subid is the identifier of the subobject to insert
 *
 * @function
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 */
function appendSubObject (req, res) {
  locks.lockObject (req.filePath, () => {
    cache.getObject (req.filePath, [])
    .then(objs => {
	if (objs.indexOf (req.params.subid) === -1) {
	objs = objs.concat (req.params.subid);
	  cache.setObject (req.filePath, objs)
	  .then( () => {
	      res.status(200).send('[]');
	  })
	  .catch( (err) => {
	      res.status(500).send('error');
	  })
	  .finally( () => {
	    locks.unlockObject (req.filePath);
	  });
	} else {
	  // Subobject already contained in object
	  res.status(200).send('[]');
	  locks.unlockObject (req.filePath);
	}
    })
    .catch(err => {
        console.log( 'Error loading object: ' + req.filePath );
        res.status(500).send('error');
        locks.unlockObject (req.filePath);
    });
  });
}

/** Verifies recursively that dst is not a subcollection of any object in srcvec.
 * If dst is found, all locks in req.lockedPaths are released and a 400 response is sent.
 * Otherwise, dst is not reachable from any object in srcvec and next() is called.
 * @function
 * @param {Array} srcvec An array of object ids of type :subtype
 * @param {String} dst An object id of type :subtype
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {Function} next
 */
function notInSourceTrees (srcvec, dst, req, res, next) {

  // Called at each node in DAG:
  // - collvec: collection children of this node
  // - seenvec: vector of all nodes encountered before this node
  // - todovec: vector of unvisited collections
  // - todocomp: vector of unvisited compendia
  function checkVec (collvec, seenvec, todovec, todocomp) {
    // Only need to check collections we have not already encountered
    collvec = collvec.filter ((id) => { return seenvec.indexOf(id) < 0 });
    // Catch duplicates
    collvec = Array.from(new Set(collvec));
    // If dst is a member of collvec, output 400 errror.
    if (collvec.indexOf( dst ) >= 0) {
      console.log ('Error: would create cycle');
      locks.unlockObjects( req.lockedPaths );
      res.status(400).send( 'would create cycle' );
      return;
    }
    // We have now seen all collections in collvec:
    seenvec = seenvec.concat( collvec );
    // but we still need to check their contents.
    todovec = collvec.concat( todovec );

    if (todovec.length !== 0) {
      // Check next collection.
      //console.log ('notInSourceTrees: testing collection ' + todovec[0] );
      req.srcCollectPath = storage.getObjectPath('collection', todovec[0]).json("collections");
      routeUtils.getJSONVector ('srcCollect', 'srcCollectPath', req, res, () => {
        checkVec( req.srcCollect, seenvec, todovec.slice(1), todocomp );
      });
    } else if (todocomp.length !== 0) {
      // No collections to check. Check next compendium.
      //console.log ('notInSourceTrees: testing compendium ' + todocomp[0] );
      const compPath = storage.getObjectPath('compendium', todocomp[0]).json("compendium");
      cache.getObject (compPath)
      .then(obj => {
          checkVec( [obj.mapsCollection], seenvec, [], todocomp.slice(1) );
      })
      .catch(err => {
          console.log( 'Could not load compendium at ' + compPath );
          console.error(err);
          res.status(500).send('error');
          locks.unlockObjects( req.lockedPaths );
      });
    } else {
      // No collections or compendiums to check.
      // No errors detected, so safe to proceed.
      next();
    }
  }

  if (req.params.subtype === 'collection')  {
    // If srcvec are collections, just check for circularity.
    checkVec (srcvec, [], [], []);
  } else if (req.params.subtype === 'compendium')  {
    // If srcvec are compendia, map to collections then check.
    checkVec ([], [], [], srcvec);
  } else {
    // Otherwise, go to next step.
    next();
  }
}

/** Express middleware that moves a subobject (:subtype,:subid) from one
 * collection (:collect1) to another (:collect2).
 * - Prerequisite: req[fromvecName] contains an array of subobject ids
 *   in the source collection.
 * - Prerequisite: req[tovecName] contains an array of subobject ids
 *   in the destination collection.
 * 
 * A 400 error is sent if the subobject is not in the source collection.
 * A 400 error is also sent if :subtype is collection and the move would create a cycle.
 *
 * @function
 * @param {String} fromvecName is the name of the field containing the ids of the objects in the source collection.
 * @param {String} tovecName is the name of the field containing the ids of the objects in the destination collection.
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
function moveSubid (fromvecName, tovecName, req, res, next) {
  const fvec = req[fromvecName];
  const tvec = req[tovecName];
  const idx = fvec.indexOf( req.params.subid );
  if (idx < 0) {
    locks.unlockObjects( req.lockedPaths );
    res.status(400).send( 'object not in source collection' );
    return;
  }
  notInSourceTrees( [req.params.subid], req.params.collect2, req, res, () => {
    if (tvec.indexOf( req.params.subid ) < 0) {
      tvec.push( req.params.subid );
    }
    fvec.splice (idx, 1);
    next();
  });
}

/** Express middleware that moves all subobjects of type :subtype from one
 * collection (:collect1) to another (:collect2).
 * - Prerequisite: req[fromvecName] contains an array of subobject ids
 *   in the source collection.
 * - Prerequisite: req[tovecName] contains an array of subobject ids
 *   in the destination collection.
 * 
 * A 400 error is sent if :subtype is collection or compendium and any move would create a cycle.
 *
 * @function
 * @param {String} fromvecName is the name of the field containing the ids of the objects in the source collection.
 * @param {String} tovecName is the name of the field containing the ids of the objects in the destination collection.
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
function moveAllSubid (fromvecName, tovecName, req, res, next) {
  const fvec = req[fromvecName];
  const tvec = req[tovecName];
  notInSourceTrees( fvec, req.params.collect2, req, res, () => {
    while (fvec.length > 0) {
      const subid = fvec.pop();
      if (tvec.indexOf( subid ) < 0) {
        tvec.push( subid );
      }
    }
    next();
  });
}

/** Express middleware that saves req[objName] in JSON format to the file req[pathName].
 * @function
 * @param {String} objName name of the request field containing the object to save.
 * @param {String} pathName name of the request field containing the object's filename.
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
function saveJSON( objName, pathName, req, res, next ){
  if (debug) console.log( 'Saving ' + objName + ' to ' + req[pathName] );
  cache.setObject( req[pathName], req[objName])
  .then( () => {
      next();
  })
  .catch( (err) => {
      locks.unlockObjects( req.lockedPaths );
      res.status(500).send( 'unable to save updated object' );
  });
}

/** Express middleware that logs message to the console.
 * @function
 * @param {String} message
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
function consoleLog( message, req, res, next ) {
  if (debug) console.log( message );
  next();
}

/** Express finalware that releases all object locks and sends a 200 response.
 * @function
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 */
function requestOK (req, res) {
  console.log( 'request OK' );
  locks.unlockObjects( req.lockedPaths );
  res.status(200).send('[]');
  return;
}

/** Express finalware that removes the subobject (:subtype, :subid) from the parent object
 * Prerequisite: req.filePath has been set to the object's subtype accessor.
 * @function
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 */
function removeSubObject (req, res) {
  locks.lockObject( req.filePath, () => {
    cache.getObject (req.filePath, [])
    .then(objs => {
        const idx = objs.indexOf (req.params.subid);
        if (idx > -1) {
            objs.splice (idx, 1);
            cache.setObject (req.filePath, objs)
            .then( () => {
                res.status(200).send('[]');
            })
            .catch( (err) => {
                res.status(500).send('error');
            })
            .finally( () => {
              locks.unlockObject( req.filePath );
            });
        } else {
            // Subobject already not contained in object
            res.status(200).send('[]');
            locks.unlockObject( req.filePath );
          }
    })
    .catch (err => {
      res.status(500).send('error');
      locks.unlockObject( req.filePath );
    });
  });
}

/** Insert the object (:subtype,:subid) into the user's named collection.
 * :name must be home, clipboard, trash, or the empty string.
 * @name Insert Object Into Named Collection
 * @route {POST} /api/insert/:subtype/:subid/collection/:name
 * @authentication Required
 */
// :type must be collection
app.post ('/api/insert/:subtype/:subid/:type',
  authenticate, routeUtils.checkmail, routeUtils.isCollection, routeUtils.isInsertable, routeUtils.subObjectExists,
  routeUtils.userRoot,
  setObjectSubtypeFilePath, appendSubObject
);
app.post ('/api/insert/:subtype/:subid/:type/home',
  authenticate, routeUtils.checkmail, routeUtils.isCollection, routeUtils.isInsertable, routeUtils.subObjectExists,
  routeUtils.userRoot,
  setObjectSubtypeFilePath, appendSubObject
);
app.post ('/api/insert/:subtype/:subid/:type/clipboard',
  authenticate, routeUtils.checkmail, routeUtils.isCollection, routeUtils.isInsertable, routeUtils.subObjectExists,
  namedUserCollection.bind( undefined, 'clipboard'),
  setObjectSubtypeFilePath, appendSubObject
);
app.post ('/api/insert/:subtype/:subid/:type/trash',
  authenticate, routeUtils.checkmail, routeUtils.isCollection, routeUtils.isInsertable, routeUtils.subObjectExists,
  namedUserCollection.bind( undefined, 'trash' ),
  setObjectSubtypeFilePath, appendSubObject
);

/** Sendmail object (:subtype,:subid) as mail to :user
 * @name Send Mail
 * @route {POST} /api/sendmail/:subtype/:subid/collection/:user
 * @authentication Required
 */
// :type must be collection
app.post ('/api/sendmail/:subtype/:subid/:type/:user',
  authenticate, routeUtils.checkmail, routeUtils.isCollection, routeUtils.isInsertable, routeUtils.subObjectExists,
  sendmailCollection, setObjectSubtypeFilePath, appendSubObject
);

/** Move object (:subtype,:subid) from collection :collect1 to collection :collect2.
 * @name Move Object
 * @route {POST} /api/move/:subtype/:subid/:collect1/:collect2
 * @authentication Required
 */
app.post ('/api/move/:subtype/:subid/:collect1/:collect2',
  consoleLog.bind( undefined, 'move subobject' ),
  authenticate, routeUtils.checkmail, routeUtils.isInsertable, // routeUtils.subObjectExists,
  setCollection.bind( undefined, 'collect1' ),
  setCollection.bind( undefined, 'collect2' ),
  consoleLog.bind( undefined, 'move subobject: collections set' ),
  routeUtils.hasModifyPermission( 'collect1' ),
  routeUtils.hasModifyPermission( 'collect2' ),
  consoleLog.bind( undefined, 'move subobject: can modify collections' ),
  setSubtypeFilePath.bind( undefined, 'fromPath', 'collect1' ),
  setSubtypeFilePath.bind( undefined, 'toPath', 'collect2' ),
  consoleLog.bind( undefined, 'move subobject: subtype filepaths bound' ),
  routeUtils.lockReqPaths.bind( undefined, [ "fromPath", "toPath" ] ),
  routeUtils.getJSONVector.bind( undefined, "fromObj", "fromPath" ),
  routeUtils.getJSONVector.bind( undefined, "toObj", "toPath" ),
  consoleLog.bind( undefined, 'move subobject: got collections' ),
  moveSubid.bind( undefined, "fromObj", "toObj" ),
  consoleLog.bind( undefined, 'move subobject: moved subid' ),
  saveJSON.bind( undefined, "toObj", "toPath" ),
  saveJSON.bind( undefined, "fromObj", "fromPath" ),
  consoleLog.bind( undefined, 'move subobject: json saved' ),
  requestOK
);

/** Move all objects of type :subtype from collection :collect1 to collection :collect2.
 * @name Move All Objects
 * @route {POST} /api/moveall/:subtype/:collect1/:collect2
 * @authentication Required
 */
app.post ('/api/moveall/:subtype/:collect1/:collect2',
  (req, res, next) => { if (debug) console.log ( 'moveall ' + req.params.subtype + ' to collection ' + req.params.collect2 ); next(); },
  authenticate, routeUtils.checkmail, routeUtils.isInsertable,
  setCollection.bind( undefined, 'collect1' ),
  setCollection.bind( undefined, 'collect2' ),
  routeUtils.hasModifyPermission( 'collect1' ),
  routeUtils.hasModifyPermission( 'collect2' ),
  setSubtypeFilePath.bind( undefined, 'fromPath', 'collect1' ),
  setSubtypeFilePath.bind( undefined, 'toPath', 'collect2' ),
  routeUtils.lockReqPaths.bind( undefined, [ "fromPath", "toPath" ] ),
  routeUtils.getJSONVector.bind( undefined, "fromObj", "fromPath" ),
  routeUtils.getJSONVector.bind( undefined, "toObj", "toPath" ),
  moveAllSubid.bind( undefined, "fromObj", "toObj" ),
  saveJSON.bind( undefined, "toObj", "toPath" ),
  saveJSON.bind( undefined, "fromObj", "fromPath" ),
  requestOK
);

/** Insert object (:subtype,:subid) into collection :objid.
 * @name Insert Object
 * @route {POST} /api/insert/:subtype/:subid/collection/:objid
 * @authentication Required
 */
// :type must be collection
app.post ('/api/insert/:subtype/:subid/:type/:objid',
  authenticate, routeUtils.checkmail, routeUtils.isCollection, routeUtils.isInsertable, routeUtils.subObjectExists,
  routeUtils.objectExists,
  routeUtils.hasModifyPermission( 'objectPath' ),
  setObjectSubtypeFilePath, appendSubObject
);

/** Remove object (:subtype,:subid) from user's named collection.
 * :name must be home, clipboard, mailbox, trash, or the empty string.
 * @name Remove Object From Named Collection
 * @route {POST} /api/remove/:subtype/:subid/collection/:name
 * @authentication Required
 */
// :type must be collection
app.delete ('/api/remove/:subtype/:subid/:type',
  authenticate, routeUtils.checkmail, routeUtils.isCollection, routeUtils.isInsertable, //routeUtils.subObjectExists,
  routeUtils.userRoot, setObjectSubtypeFilePath, removeSubObject
);
app.delete ('/api/remove/:subtype/:subid/:type/home',
  authenticate, routeUtils.checkmail, routeUtils.isCollection, routeUtils.isInsertable, //routeUtils.subObjectExists,
  routeUtils.userRoot, setObjectSubtypeFilePath, removeSubObject
);
app.delete ('/api/remove/:subtype/:subid/:type/clipboard',
  authenticate, routeUtils.checkmail, routeUtils.isCollection, routeUtils.isInsertable, //routeUtils.subObjectExists,
  namedUserCollection.bind( undefined, 'clipboard'), routeUtils.objectExists, setObjectSubtypeFilePath, removeSubObject
);
app.delete ('/api/remove/:subtype/:subid/:type/mailbox',
  authenticate, routeUtils.checkmail, routeUtils.isCollection, routeUtils.isInsertable, //routeUtils.subObjectExists,
  namedUserCollection.bind( undefined, 'mailbox' ), routeUtils.objectExists, setObjectSubtypeFilePath, removeSubObject
);
app.delete ('/api/remove/:subtype/:subid/:type/trash',
  authenticate, routeUtils.checkmail, routeUtils.isCollection, routeUtils.isInsertable, //routeUtils.subObjectExists,
  namedUserCollection.bind( undefined, 'trash' ), routeUtils.objectExists, setObjectSubtypeFilePath, removeSubObject
);

/** Remove object (:subtype,:subid) from collection :objid.
 * @name Remove Object From Collection
 * @route {POST} /api/remove/:subtype/:subid/collection/:objid
 * @authentication Required
 */
// :type must be collection
app.delete ('/api/remove/:subtype/:subid/:type/:objid',
  authenticate, routeUtils.checkmail, routeUtils.isCollection, routeUtils.isInsertable, //routeUtils.subObjectExists,
  routeUtils.objectExists,
  routeUtils.hasModifyPermission( 'objectPath' ),
  setObjectSubtypeFilePath, removeSubObject
);

/** Search collection :objid for chms containing :searchstr.
 * @name Find Matching NG-CHMs
 * @route {GET} /api/search/collection/:objid/:searchstr
 * @authentication Not required
 */
// :type must be collection
app.get ('/api/search/:type/:objid/:searchstr',
  routeUtils.isCollection, routeUtils.objectExists,
  function (req, res, next) { // eslint-disable-line no-unused-vars
    req.results = [];
    req.viewerPath = storage.getTypeAccessor('viewer');

    function searchChm () {
      if (req.chms.length===0) {
        res.json ({'data': req.results});
      } else {
        const chm = req.chms.pop();
        cache.getObject (req.viewerPath.object(chm).json("heatmapProperties"))
        .then(props => {
            const obj = { 'id': chm, 'name': props.chm_name, 'tags': [] };
            for (let ii = 0; ii < props.chm_attributes.length; ii++) {
              if (props.chm_attributes[ii].hasOwnProperty ('chm.info.build.time')) {
                obj.buildDate = props.chm_attributes[ii]['chm.info.build.time'];
              }
            }
            req.results.push( obj );
            searchChm();
        })
        .catch(err => {
            console.log('Error getting heatmapProperties for chm ' + chm);
            console.error(err);
            searchChm();
        });
      }
    }

    cache.getObject(req.objectPath.json("chms"), [])
    .then(chms => {
        req.chms = chms.slice();
        searchChm();
    })
    .catch(err => {
        res.status(500).send('error');
    });
  }
);

/** Return object (:type,:objid) as a tar archive
 * @name Get Object As Tar Archive
 * @route {GET} /api/tar/:type/:objid
 * @authentication Not required
 */
app.get ('/api/tar/:type/:objid', routeUtils.objectExists,
  storage.localizeObject,
  function (req, res, next) { // eslint-disable-line no-unused-vars
    if (debug) console.log ('Creating tar archive for ' + req.objectPath);
    res.writeHead (200, {
      'Content-Type': 'binary'
    });
    const tar = spawn ('tar', ['cf', '-', '-C', req.objectPath.path, '.']);
    tar.stdout.on('data', (data) => {
      res.write(data);
    });
    tar.stderr.on('data', (data) => {
      console.log(`tar stderr: ${data}`);
    });
    tar.on('close', (code) => { /* eslint-disable-line no-unused-vars */
      res.end();
      next();
    });
  },
  storage.freeLocalizedObject
);

/** Create object (:type,:objid) from a tar archive
 * - Prerequisite: :type cannot be collection.
 * - Prerequisite: object must not already exist.
 * - Prerequisite: the claimed :objid must match the sha1 of the contents of the tar archive.
 * <p></p>
 *
 * @name Create Object From Tar Archive
 * @route {PUT} /api/tar/:type/:objid
 * @authentication Required
 */
app.put ('/api/tar/:type/:objid', authenticate, routeUtils.checkmail, routeUtils.isNotCollection, routeUtils.objectDoesNotExist,
  function (req, res, next) { // eslint-disable-line no-unused-vars
    // Create temporary directory and unpack incoming tar file into it.
    if (debug) console.log(`put ${req.objectPath}`);
    storage.createTempObject (req.typeName, req.objectId, (err, tmpObjectPath) => {
      if (err) console.log(`createTempObject err==${err}`);
      const tar = spawn ('tar', ['xf', '-', '--no-same-owner', '--no-same-permissions', '-C', tmpObjectPath]);
      req.on('data', function(data) {
        tar.stdin.write(data);
      });
      req.on('end', function() {
        tar.stdin.end();
      });
      tar.stderr.on('data', (data) => {
        console.log(`tar stderr: ${data}`);
      });
      tar.on('close', (code) => {
        if (code !== 0) {
          if (debug) console.log(`tar.on.close: code==${code}`);
          res.status(422).send('cannot decode object');
          storage.removeTempObject (tmpObjectPath);
        } else {
          // Verify claimed id matches contents
          shaidy.gitHashObject (tmpObjectPath, (digest) => {
            if (req.objectId === digest) {
              storage.moveTempObject (tmpObjectPath, req.typeName, req.objectId, (err) => {
                if (err) {
                  console.log(`put rename failed`);
                  console.error(err);
                  res.status(500).send('error saving object');
                } else {
		  cache.setObjectExists (req.objectPath);
                  res.status(200).send('[]');
                }
              });
            } else {
              console.log(`put githash failed`);
              res.status(400).send('bad digest');
              storage.removeTempObject (tmpObjectPath);
            }
          });
        }
      });
    })
  }
);

/** Returns a JSON object containing the shaids in the query that exist on the server:
 * ```javascript
 * { 'data': [ ids ] }
 * ```
 * <p></p>
 * @name Exists
 * @route {GET} /api/exists
 * @authentication Not required.
 * @queryparam {String} ids is a comma-separated list of shaids to check.
 * Each shaid in the list must be of the form type/objid.
 */
app.get ('/api/exists', function (req, res) {
  const typeList = storage.listTypes();
  const ids = req.query.ids ? req.query.ids.split(',') : [];
  // Create an existence promise for each object,
  // which will resolve to the objid if it exists
  // and to false otherwise.
  const tasks = ids.map(function (objid) {
    return new Promise(function (resolve) {
          if (debug) console.log ('/api/exists ' + objid);
	  const ff = objid.split('/');
	  if (typeList.indexOf(ff[0]) < 0 || ff[1]==='..') {
              // Non-existent types and attempts to crack the system fail.
              resolve(false);
          } else if (ff[0]==='collection' && ff[1]==='') {
              // The root collection always exists!
              resolve(objid);
	  } else {
              // Otherwise query cache for object.
	      cache.objectExists (storage.getObjectPath(ff[0], ff[1]))
              .then(exists => {
                  resolve (exists && objid)  // false or objid
	      })
              .catch(err => {
                  console.log ('Error testing existence of ' + objid);
                  console.error (err);
                  resolve(false);
              });
	  }
    });
   });
   Promise.all(tasks).then(function (results) {
      res.json ({'data': results.filter(id => id)}); // Remove false entries.
   })
   .catch(err => {
      console.log ('Error in /api/exists');
      console.error (err);
      res.status(500).send();
   });
});

const seaview = require('./seaview');
seaview.defineSeaviewRoutes (app);

dataAccessServices.defineDataAccessRoutes (app);
managers.defineManagerRoutes (app);

app.use(function (req, res) {
    if (debug) console.log ('Could not find ' + req.originalUrl);
    res.status(404).send("Sorry can't find that!")
})


storage.initializeStorageSystem().then (() => {

    const server = app.listen(8080);

    console.log('Express server started on port 8080');
    process.on ('SIGTERM', gracefulShutdown);

    function gracefulShutdown() {
        console.log("Received kill signal, shutting down gracefully.");
        server.close((function() {
            console.log("Closed out remaining connections.");
            process.exit();
        }));
    }
})
.catch (err => {
    console.log ('Error: could not initialize shaidy storage system');
    console.error (err);
    process.exit(1);
});
