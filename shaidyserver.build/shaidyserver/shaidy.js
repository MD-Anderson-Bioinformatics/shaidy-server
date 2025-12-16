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
/*eslint security/detect-object-injection: "off" */

/**
 * Utility functions for working with shaidy objects.
 *
 * @module shaidy
 */
const crypto = require('crypto');
const recursive = require('recursive-readdir');
const spawn = require('child_process').spawn;   // eslint-disable-line security/detect-child-process

/** Create an SHA1 hash of the parameter.  The hash is compatible with the
 * SHA1 hash that would be computed by git.
 * @param {String} data is the string to be hashed.
 * @returns {String}
 */
exports.gitSha = function (data) {
  let hash = crypto.createHash('sha1');
  hash.update("blob " + data.length);
  hash.update('\0');
  hash.update(data);
  return hash.digest('hex');
}

// Test that gitSha returns the same values as git.
if (exports.gitSha("") !== "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391") {
  throw new Error ('gitSha failed test');
}
if (exports.gitSha("foobar\n") !== "323fae03f4606ea9991df8befbb2fca795e648fa") {
  throw new Error ('gitSha failed foobar test');
}

/** Create a random string that can be used as a UUID.
 * @param {String} prev is a previous UUID (or empty)
 * @returns {String}
 */
exports.getuuid = function (prev) {
  let hash = crypto.createHash('sha256');
  hash.update("" + prev);
  hash.update([1,2,3,4,5].map(Math.random).join('+'));
  return hash.digest('hex');
}

/** Create an SHA1 digest of the specified shaid object.
 * @param {String} objectPath is the root directory of the shaid object in the filesystem.
 * @param {gitHashCallback} callback is called with the shaid digest.
 */
exports.gitHashObject = function (objectPath, callback) {
  recursive (objectPath, (err, files) => {
    let sha = [];
    let waiting = files.length;
    sha.length = files.length;
    files.sort();
    files.forEach ((file, idx) => {
       let git = spawn ('git', ['hash-object', file]);
       git.stdout.on('data', (data) => { sha[idx] = (sha[idx]||'') + (''+data).replace(/[\r\n]+/,'') });
       git.on ('close', (code) => { /* eslint-disable-line no-unused-vars */
         if(--waiting === 0) done();
       });
    });
    function done () {
      let summary = files.map ((file, idx) => {
        return file.replace(objectPath+'/','') + '=' + sha[idx];
      }).join(',');
      let digest = exports.gitSha (summary);
      console.log (summary + '\n');
      console.log (digest + '\n');
      callback (digest);
    }
  });
}

/** async wrapper for gitHashObject
 *
 * @param {String} path is the root directory of the shaid object in the filesystem.
 */
exports.getgitHash = async function (path) {
  return await new Promise((resolve, reject) => {
    exports.gitHashObject(path, (chmShaid) => {
      resolve(chmShaid);
    });
  });
}


/** @callback gitHashCallback
 * @param {String} digest is the object digest.
 */
