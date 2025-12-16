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

const Promise = require ('promise');
const storage  = require('./storage');
const cache = require ('./cache');

/** Scan all collections in a DAG of collections.
 * For each collection in the DAG, nodefn is called once,
 * in an unspecified order.  Calls to nodefn will
 * accummulate a result that will be available after the
 * scan is complete.
 *
 * @function
 * @param {ProcessNodeFn} nodefn is called once for each collection in the DAG.
 * @param {Any} result is initial value of result passed to nodefn.
 * @param {Array} srcvec is a vector of the 'root' collections in the DAG.
 * @param {ScanDoneFn} donefn is called after all collections in the DAG
 *           have been processed, or after an error.
 *
 * nodefn will be passed three parameters:
 *  - result, the most recent value of result
 *  - collectionId, the shaid of the current collection,
 *  - resume, a function that resumes the scan.
 *
 * If the nodefn ever passes back a truthy value of err when resuming the scan,
 * the scan is immediately aborted and donefn is called with that value of
 * err and the corresponding result value.
 * If err is never truthy, donefn will be called after all collections
 * in the DAG have been scanned. It will be passed three paramters:
 *  - err, which will be null,
 *  - seenvec, an array of all collections visited,
 *  - and result, the value of result that was passed to the last call to resume scan.
 *
 */
exports.scanDAG = function (nodefn, result, srcvec, donefn) {

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
      donefn( null, seenvec, result );
      return;
    }

    // Call nodefn for first collection we still need to check
    nodefn( result, todovec[0], (err, result) => {
      if (err) {
        // Call donefn immediately on error
        donefn( err, null, null );
      } else {
        // Scan children of current collection
        const subCollectPath = storage.getObjectPath('collection', todovec[0]).json('collections');
        cache.getObject (subCollectPath)
        .then(object => {
            scanvec( result, object, seenvec, todovec.slice(1) );
        })
        .catch(err => {
            console.log ('ScanDAG: unable to load subcollection ' + subCollectPath);
            console.error (err);
            scanvec( result, [], seenvec, todovec.slice(1) );
        });
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
 * @param {Array} seenvec is a vector of the collections visited.
 * @param {Any} result is the final value of result.
 */

