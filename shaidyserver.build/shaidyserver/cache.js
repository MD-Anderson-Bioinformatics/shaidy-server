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

/*global console*/
/*global exports*/
/*eslint security/detect-non-literal-fs-filename: "off" */
/*eslint security/detect-object-injection: "off" */

const debug = false;

/** A simple LRU-cache for frequently accessed JSON objects stored in the filesystem.
 * Objects saved to the cache are also immediately written to the filesystem (write-through cache).
 * 
 * @module cache
 */
const cacheMaxAge = (+process.env.NGCHM_CACHE_MAX_AGE || 600) * 1000;
const fs = require('fs');  // For deprecated filesystem path support.
const storage  = require('./storage')
    , LRU = require( 'lru-cache' )
    , options = { max: 50000, maxAge: cacheMaxAge };

const lrucache = new LRU( options );
const existsLRUCache = new LRU( options );

/** Return a Promise for a JSON object.
 * @param {String} objectPath The filesystem path to the stored JSON file.
 * @param {any} defaultValue If there is no object at objectPath but defaultValue is defined, defaultValue is returned.
 */
exports.getObject = function (objectPath, defaultValue) {
    if (defaultValue && typeof defaultValue === 'function') {
        console.log ({ m: 'ERROR OBSOLETE cache.getObject passed callback function', objectPath });
	defaultValue ('callback passed to cache.getObject');
    }
    const key = typeof objectPath === 'object' ? objectPath.path : objectPath;  // Use .path for compatibility with legacy filesystem path.
    let obj = lrucache.get( key );
    if (obj === undefined) {
	obj = new Promise ((resolve, reject) => {
	    if (typeof objectPath === 'object') {
		// objectPath is in storage system.
		objectPath.readFile ((err,data) => {
		    fn (false, err, data);
		});
	    } else {
		// Legacy access to filesystem path. Deprecated.
		console.log ({ m: 'DEPRECATED getObject', objectPath });
		fs.readFile( key, "utf8", (err,data) => {
		    fn (true, err, data);
		});
	    }
		function fn (parseJ, err, data) {
		      if (err) {
			if ((defaultValue !== undefined) && err.name==='Error' && err.code === 'ENOENT') {
			  resolve(defaultValue);
			}  else {
			  console.log( 'Error reading object at ' + objectPath );
			  reject(err);
			}
		      } else if (parseJ) {
			try {
			     const json = JSON.parse( data );
			     resolve(json);
		        } catch( parseerr ) {
			console.log( 'Error parsing object at ' + objectPath + ' err=' + parseerr );
			    reject (parseerr);
		        }
		      } else {
			resolve (data);
		      }
		}
	});
	lrucache.set( key, obj );
    }
    if (debug) console.log ({ m: 'cache.getObject', key, obj });

    return obj;
};

/** Return a Promise for a TSV-index object.  The object is a map from labels to values.
 * @param {String} objectPath The storage system path to the stored index file.
 */
exports.getIndex = function (objectPath) {
    const key = typeof objectPath === 'object' ? objectPath.path : objectPath;
    let P = lrucache.get( key );
    if (P === undefined) {
	P = new Promise((resolve, reject) => {
	    if (typeof objectPath === 'object') {
		storage.readFile (objectPath, fn);
	    } else {
		fs.readFile( objectPath, "utf8", fn);
	    }

	    function fn (err, data) {
		if (err) {
		    console.log( 'Error reading index object at ' + objectPath );
		    reject(err);
		} else try {
		    const obj = data.split( '\n' ).reduce( function (map, line) {
			    const fields = line.split('\t');
			    if (fields.length === 2) map[fields[0]] = +fields[1];
			    return map;
		    }, {} );
		    resolve(obj);
		} catch( parseerr ) {
		    console.error( 'Error parsing object at ' + objectPath + ' err=' + parseerr );
		    reject( parseerr );
		}
	    }
	});
	lrucache.set (key, P);
    }
    return P;
};

/** Set a JSON object.
 * The given object is stored in both the cache and storage system (write through cache).
 * @param {String} objectPath is the storage system path at which to store the object (as JSON).
 * @param {Object} object is the object to store.
 * @param {SetObjectFn} If provided, callback is called after the object has been stored. Otherwise
 * a Promise is returned.
 * The object is always stored, temporarily, in the cache, even if there is a problem saving the object
 * to the storage system.
 */
exports.setObject = function (objectPath, object, callback) {
    const key = typeof objectPath === 'object' ? objectPath.path : objectPath;
    lrucache.set( key, Promise.resolve(object) );
    if (typeof objectPath === 'object') {
       const P = storage.writeJSON (objectPath, object);
       if (callback) {
	  P.then(() => callback(null)).catch(err => callback(err));
       } else {
	  return P;
       }
    } else {
	fs.writeFile( objectPath, JSON.stringify( object ), err => {
	    if (callback) {
		callback (err);
	    } else {
		return err ? Promise.reject(err) : Promise.resolve();
	    }
	});
    }
};

/* Create object at objectPath and initialize jsonfield to contents (an object).
 */

exports.setObjectExists = function (objectPath) {
   const cacheKey = objectPath.toString();
   existsLRUCache.set(cacheKey, Promise.resolve(true));
}

/** Return a promise for the existence of the object.
 */
exports.objectExists = function (objectPath) {
    if (debug) console.log({ '>cache.objectExists': objectPath });
    const cacheKey = objectPath.toString();
    let P = existsLRUCache.get (cacheKey);
    if (P === undefined) {
        P = new Promise (resolve => {
	    storage.objectExists (objectPath, (exists) => {
		existsLRUCache.set (cacheKey, Promise.resolve(exists));
	        if (debug) console.log({ '<cache.objectExists': objectPath, exists });
		resolve (exists);
	    });
	});
        existsLRUCache.set(cacheKey, P);
    }
    return P;
}

/* Create object at objectPath and initialize jsonfield to contents (an object).
 */
exports.createObjectAndFile = function (objectPath, jsonfield, contents ) {
    return storage.createNewObject (objectPath)
    .then (() => {
        existsLRUCache.set (objectPath.toString(), Promise.resolve(true));
        return exports.setObject( objectPath.json(jsonfield), contents );
    });
}
