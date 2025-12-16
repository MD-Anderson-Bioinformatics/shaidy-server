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

const storage = require('./storage');
const cache = require('./cache');
const locks = require('./locks');

const debug = false;

/********************************************************************/

{
    /** An express Request object.
     * @typedef {Object} ExpressRequest
     */
    /** An express Response object.
     * @typedef {Object} ExpressResponse
     */
    /** An express next callback.
     * @callback ExpressNext
     */

    exports.checkmail = function checkmail( req, res, next ) {
      if (!req.user.mail) {
	req.user.mail = req.user.email || req.user["https://shaidyserver/email"];
      }
      if (!req.user.mail) {
	res.status(404).send('mail address not found');
      }
      else if (req.user.mail.length < 1 || req.user.mail.indexOf(storage.pathSeparator) >= 0 || req.user.mail==='..') {
	res.status(404).send( 'bad user email address' );
      }
      else {
	req.user.mail = req.user.mail.toLowerCase();
	next();
      }
    };

    /** Returns express middleware that verifies that the user is authorized
     * to modify the object whose path is stored in req[objectPathName].
     *
     * @function
     * @param {String} objectPathName  Name of the object path in request
     * @returns {ExpressMiddleWare}
     *
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res
     * @param {ExpressNext} next
     */
    exports.hasModifyPermission = function (objectPathName) {
        return canModifyObject.bind (undefined, objectPathName);

	function canModifyObject (objectPathName, req, res, next) {
	  if (debug) console.log ({ m: 'Validating permission to modify', user: req.user.mail, objectPathName, object: req[objectPathName] });
	  cache.getObject (req[objectPathName].json('permissions'), [])
	  .then(data => {
	    if (Array.isArray(data) && data.length === 0) {
	      // If no permissions object, anyone can modify.
              if (debug) console.log ("No permissions object, anyone can modify");
	      next();
	    } else {
	      // If permissions specified, write access requires explicit permission.
	      if (debug) console.log({ m: 'Permissions check', user: req.user.email, data: data });
	      if (data.write && data.write.indexOf( req.user.mail ) >= 0) {
		  if (debug) console.log ("Modify permission granted");
		  next();
	      } else {
		  if (debug) console.log("Modify permission forbidden");
		  res.status(403).send( 'forbidden' );
	      }
	    }
	  })
	  .catch(err => {
	      console.log( 'Error loading permissions for ' + req[objectPathName] );
	      res.status(500).send( 'error loading permissions' );
	  });
	}
    };

}

/********************************************************************/

{
    /** Express middleware that verifies that the object type is a compendium.
     * If not, control is passed to the next route.
     * @function
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res
     * @param {ExpressNext} next
     */
    exports.isCompendium = isType.bind( undefined, 'compendium' );

    /** Express middleware that verifies that the object type is a collection.
     * If not, control is passed to the next route.
     * @function
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res
     * @param {ExpressNext} next
     */
    exports.isCollection = isType.bind( undefined, 'collection' );

    /** Express middleware that verifies that the object type is a dataset.
     * If not, control is passed to the next route.
     * @function
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res
     * @param {ExpressNext} next
     */
    exports.isDataset = isType.bind( undefined, 'dataset' );

    /** Express middleware that verifies that the object type is not a collection.
     * If it is, control is passed to the next route.
     * @function
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res
     * @param {ExpressNext} next
     */
    exports.isNotCollection = isNotType.bind( undefined, 'collection' );

    /** Express middleware that verifies that the object type is an NG-CHM.
     * If not, control is passed to the next route.
     * @function
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res
     * @param {ExpressNext} next
     */
    exports.isCHM = isType.bind( undefined, 'chm' );

    /** Express middleware that verifies that :subtype is insertable.
     * If not, control is passed to the next route.
     * @function
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res
     * @param {ExpressNext} next
     */
    const insertableTypes = ["chm","matrix","label","collection","compendium"];
    exports.isInsertable = function isInsertable (req, res, next) {
      if (insertableTypes.indexOf(req.params.subtype) !== -1) {
          next ();
      } else {
          next ('route');
      }
    };

    /** Express middleware that verifies that the object type equals typeName.
     * If not, control is passed to the next route.
     * @function
     * @param {string} typeName
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res
     * @param {ExpressNext} next
     */
    function isType( typeName, req, res, next ) {
        if (req.typeName === typeName) {
            next();
        } else {
            next('route');
        }
    }

    function isNotType( typeName, req, res, next ) {
        if (req.typeName !== typeName) {
            next();
        } else {
            next('route');
        }
    }
}

/********************************************************************/

{
    /** Express middleware that verifies that the object (:type,:objid) exists.
     * If not, a 404 response is sent.
     * @function
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res
     * @param {ExpressNext} next
     */
    exports.objectExists = function objectExists (req, res, next) {
      if (debug) console.log( '>index.objectExists: ' + JSON.stringify( req.objectValid ) );
      if (req.objectValid === undefined) {
          cache.objectExists (req.objectPath)
          .then( exists => {
	      if (debug) console.log ({ '=cache.objectExists': req.objectPath, exists });
              req.objectValid = exists;
              if (exists) {
                  next();
              } else {
                  res.status(404).send(req.typeName + ' not found');
              }
          });
      } else if (req.objectValid) {
        if (debug) console.log({ '<index.objectExists': req.objectValid });
        next();
      } else {
        if (debug) console.log({ '!index.objectExists': req.objectValid });
        res.status(404).send(req.typeName + ' not found');
      }
    };

    /** Express middleware that verifies that the object (:type,:objid) does not exist.
     * If it does, a 403 response is sent.
     * @function
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res
     * @param {ExpressNext} next
     */
    exports.objectDoesNotExist = function objectDoesNotExist (req, res, next) {
      if (req.objectValid === undefined) {
          cache.objectExists (req.objectPath)
          .then( exists => {
              req.objectValid = exists;
              if (exists) {
                  res.status(403).send(req.typeName + ' already exists');
              } else {
                  next();
              }
          });
      } else if (req.objectValid) {
        res.status(403).send(req.typeName + ' already exists');
      } else {
        next();
      }
    };

    /** Express middleware that verifies that the subobject (:subtype,:subid) exists.
     * If not, a 404 response is sent.
     * @function
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res
     * @param {ExpressNext} next
     */
    exports.subObjectExists = function subObjectExists (req, res, next) {
      if (req.params.subid === '..') {
        res.status(400).send('bad request');
        return;
      }
      const subPath = storage.getObjectPath(req.params.subtype, req.params.subid);
      if (debug) console.log ('subobject ' + req.params.subtype + ' ' + req.params.subid);
      storage.objectExists (subPath, function (exists) {
        if (exists) {
          next();
        } else {
          res.status(404).send('subobject ' + req.params.subtype + '/' + req.params.subid + ' not found');
        }
      });
    };

}

/********************************************************************/

{
    /** Express middleware that sets req.objectPath to the path of :prop.json for
     * the object at req.objectPath.
     * @function
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res
     * @param {ExpressNext} next
     */
    exports.propertyPath = function propertyPath( req, res, next ) {
        req.objectPath = req.objectPath.json(req.propName);
        next();
    };

    /** Express finalware that sends the JSON object at path req.objectPath to the user as JSON:
     * ```javascript
     * { 'data': object }
     * ```
     * <p></p>
     * @function
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res
     */
    exports.sendObjectAsJSON = function sendObjectAsJSON( req, res ) {
        cache.getObject (req.objectPath, [])
        .then(data => {
            res.json( { data: data } );
        })
        .catch(err => {
            console.log( 'error loading property: ' + req.objectPath );
            res.status(500).send( 'error loading property' );
        });
    };

    /** Express middleware that sets req.objectPath to the root of the user's home directory.
     * @function
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res
     * @param {ExpressNext} next
     * @authentication Required.
     */
    exports.userRoot = function userRoot (req, res, next) {
        req.objectPath = storage.getSpecialCollection(req.user.mail, 'home');
        req.objectValid = true;
        storage.makeObjectIfNeeded (req.objectPath, next);
    };

}

/********************************************************************/

/** Express middleware (after binding pathNames) that acquires locks for the
 * objectPaths in req[pathNames], where each name in the pathNames array is
 * the name of a field in the request object.
 * @function
 * @param {Array} pathNames
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
exports.lockReqPaths = function lockReqPaths (pathNames, req, res, next) {
    const paths = pathNames.map( (nn) => { return req[nn]; } );
    console.log( 'Locking ' + paths.join(', '));
    locks.lockObjects( paths, () => {
        req.lockedPaths = paths;
        next();
    });
};

/** Express middleware (after binding objName and pathName) that loads the
 * object at req[pathName] and stores it in req[objName].
 * If an error occurs, all paths in req.lockedPaths are released and a 500
 * response is sent.
 * @function
 * @param {String} objName name of the request field into which the object will be stored
 * @param {String} pathName name of the request field containing the object path
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res
 * @param {ExpressNext} next
 */
exports.getJSONVector = function getJSONVector (objName, pathName, req, res, next) {
    //console.log( 'Getting ' + objName + ' from ' + req[pathName] );
    cache.getObject (req[pathName], [])
    .then(object => {
        req[objName] = object;
        next();
    })
    .catch(err => {
        locks.unlockObjects( req.lockedPaths );
        res.status(500).send( 'error' );
    });
};
