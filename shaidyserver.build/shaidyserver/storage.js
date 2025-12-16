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

/* This module implements a generic interface to the storage module.
 *
 * The specific storage backend must be specified by setting the STORAGE_BACKEND
 * environment variable.
 *
 * Clients of the storage module should only access storage APIs through this
 * module.  They must not directly access the storage backend.
 */
const debug = true;

if (debug) console.log ('Loading generic storage module');
console.log ('STORAGE_BACKEND is ' + process.env.STORAGE_BACKEND);
if (!process.env.STORAGE_BACKEND) {
    throw new Error('required environment variable STORAGE_BACKEND is not defined');
}

/* If the storageBackend is not 'filesystem', use the filesystem backend for staging objects
 * in and out.  If the storageBackend is 'filesystem', there is no need for a staging area.
 */
const stageStorage = process.env.STORAGE_BACKEND === 'filesystem' ? null : wrapBackend(require ('./storage-backend-filesystem'));
if (stageStorage) stageStorage.initialize(false);


/* Define the storage backend of record.
 */
const storageBackend = require ('./storage-backend-' + process.env.STORAGE_BACKEND);
storageBackend.initialize(true, stageStorage);

/* Wrap exports from backend module, so storage clients don't need to
 * access the backend directly.
 */
function wrapBackend (backend) {
    return Object.assign ({}, backend);
}

module.exports = wrapBackend (storageBackend);
if (stageStorage) {
    module.exports.getLocalRepoPath = stageStorage.getLocalRepoPath;
}

if (debug) console.log ('Generic storage module loaded');
