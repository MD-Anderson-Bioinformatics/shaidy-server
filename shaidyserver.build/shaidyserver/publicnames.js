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

const LRU = require( 'lru-cache' );
const cache = require( './cache' );

/* Matching rules:
 * 1. The empty hostspec matches everything.
 * 2. If a hostspec begins with a period any hostname within that domain is okay.
 * 3. Otherwise, an exact match is required.
 * Examples:
 * Rule 2: Hostspec .ngchm.net : tcga.ngchm.net matches but ngchm.net does not.
 * Rule 3: Hostspec www.ngchm.net : Only www.ngchm.net matches.
 */
function hostMatches (hostname, hostspec) {
    if (hostspec.length === 0) {
        return true;
    } else if (hostspec.substr(0,1) === '.') {
        return hostname.substr(hostname.length - hostspec.length) === hostspec;
    } else {
        return hostname === hostspec;
    }
}

/* Return a promise for the publicNames mapping for the given object type.
 */
const getPublicNames = (function () {

    const publicNamesCache = new LRU( { max: 25, maxAge: debug ? 1000 : 600000 } );
                                     // Ten minutes.

    return function getPublicNames (typeAccessor) {
        const obj = typeAccessor.json('publicNames');
        const key = obj.toString();
        let P = publicNamesCache.get(key);
        if (P === undefined) {
            P = cache.getObject (obj, {})
                .catch ((err) => {
		    if (debug) {
                        console.log ('Error getting ' + key.toString());
                        console.error (err);
		    }
                    return null;
                });
            publicNamesCache.set (key, P);
        };
        return P;
    };
})();

/* Return a promise for an array of all the public objects of the
 * given type.
 */
exports.listPublicIds = function (typeAccessor) {
    function isUnique(val,idx,arr) { return arr.indexOf(val) === idx; }
    return getPublicNames(typeAccessor).then(data => {
        return ((data && data.publicNames)||[]).map(e => e.id).filter(isUnique);
    });
};

exports.changePublicName = function (objectPath, newName, currentName) {
	return false;
};

// Set req.objectId to (mapped) id and req.objectPath to the storage path for that object.
// Pre: req.objectPath is set to storage path for current object type.
// If id matches a well known name for that object type, the name is
// replaced by the object's id.
// A well known name is a string consisting of a hostspec optionally followed
// by a slash and a public object name.
exports.mapPublicId = (function() {

    const lrucache = new LRU( { max: 100, maxAge: debug ? 1000 : 540000 }  );
                                // 9 minutes.

    return function mapPublicId (req, res, id, next) {
      const key = req.hostname + ' - ' + req.objectPath.toString() + ' - ' + id;
      if (debug) console.log('> mapPublicId: ' + key);
      let idProm = lrucache.get(key);
      if (idProm === undefined) {
        idProm = 
          getPublicNames(req.objectPath)
          .then ( function (data) {
              if (debug) console.log ('Public names:');
              if (debug) console.log (data);
              if (data && data.publicNames) {
                  let idx = 0;
                  while (idx < data.publicNames.length) {
                      if (debug) console.log (data.publicNames[idx].name + ' => ' + data.publicNames[idx].id);
                      const ff = data.publicNames[idx].name.split('/');
                      if ((ff.length === 2 && ff[1] === id) || (ff.length === 1 && '' === id)) {
                          if (hostMatches(req.hostname, ff[0]))  {
                              if (debug) console.log('mapPublicId: ' + key + ' => ' + data.publicNames[idx].id);
                              return data.publicNames[idx].id;
                          }
                      }
                      idx = idx + 1;
                  }
              }
	      if (debug) console.log('mapPublicId: ' + key + ': no mapping');
              return id;
          });
        lrucache.set (key, idProm);
      }

      idProm.then(function(id) {
        if (id === '') {
            /* No default object for the request's hostname. */
            res.status(404).send();
        } else {
            req.objectId = id;
            req.objectPath = req.objectPath.object(id);
            next();
        }
      });
  }
})();

