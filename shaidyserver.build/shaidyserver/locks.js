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
/**
 * A simple locking mechanism to prevent race conditions by
 * concurrent accesses to shared resources.  Users must
 * follow the following protocol:
 * + Obtain locks for **all** objects that could be modified.
 * + Obtain current value for all locked objects.
 * + Update all objects to be modified.
 * + Release all locks.
 *
 * All required locks **must** be acquired in a **single** call to either
 * lockObject or lockObjects.  Locks must also be released using
 * a **single** call to either unlockObject or unlockObjects.
 *
 * A user can also acquire a 'manager' lock. No other process
 * can acquire a manager lock or any object lock while the
 * manager lock is held.
 *
 * @module locks
 */
var objectLocks = [];

var usersInMutex = 0;
var managerInMutex = false;
var blockedUsers = [];
var blockedManagers = [];

/** Internal function that acquires a user lock on the mutex.
 * @param {LockCallback} callback is called when the lock is obtained.
 */
function enterMutex( callback ) {
  if (managerInMutex) {
    blockedUsers.push( callback );
  } else {
    usersInMutex = usersInMutex + 1;
    callback();
  }
}

/** Internal function that releases a user lock on the mutex.
 */
function exitMutex() {
  if (usersInMutex <= 0) {
    console.log ('Error: usersInMutex is not positive (' + usersInMutex + ') in exitMutex');
    usersInMutex = 0;
  } else {
    usersInMutex = usersInMutex - 1;
  }
  if (managerInMutex) {
    console.log ('Error: managerInMutex is true in exitMutex');
  } else if (usersInMutex === 0 && blockedManagers.length > 0) {
    managerInMutex = true;
    let callback = blockedManagers.pop();
    callback();
  }
}

/** Acquire a manager lock.  When the manager lock is held, no
 * other manager or object locks can be held.
 * @param {LockCallback} callback is called when the lock is obtained.
 */
exports.getManagerLock = function( callback ) {
  if (usersInMutex === 0 && !managerInMutex) {
    managerInMutex = true;
    callback();
  } else {
    blockedManagers.push( callback );
  }
}

/** Release a manager lock.
 */
exports.releaseManagerLock = function() {
  if (blockedManagers.length > 0) {
    let callback = blockedManagers.pop();
    callback();
  } else {
    managerInMutex = false;
    while (blockedUsers.length > 0) {
      usersInMutex = usersInMutex + 1;
      let callback = blockedUsers.pop();
      callback();
    }
  }
}

/** Internal function to acquire a write lock for a single object.
 * Requires that caller has acquired user access to the Mutex.
 *
 * @param {String} objectPath is the filesystem path to the object.
 * @param {LockCallback} callback is called when the lock is obtained.
 */
function lockOneObject (objectPath, callback) {
  // Determine if this object is currently locked.
  let locks = objectLocks.filter (function (objectLock) {
    return (objectLock.path === objectPath);
  });
  // If so, just add the current callback to the waiting list.
  if (locks.length > 0) {
    locks[0].callbacks.push (callback);
    return;
  }
  // If not, create object lock
  objectLocks.push (new Object({ path: objectPath, callbacks: [] }));
  callback ();
}

/** Internal function to release a previously acquired lock on an object.
 * Requires caller to release user access to the Mutex.
 *
 * @param {String} objectPath is the filesystem path to the object.
 */
function unlockOneObject (objectPath) {
  // Determine if this object is currently locked.
  let locks = objectLocks.filter (function (objectLock) {
    return (objectLock.path === objectPath);
  });
  if (locks.length !== 1) console.log ('wrong number of objectLocks');
  if (locks[0].callbacks.length === 0) {
      objectLocks = objectLocks.filter (function (objectLock) {
	return (objectLock.path !== objectPath);
      });
  } else {
    let callback = locks[0].callbacks.pop();
    callback();
  }
}

/** Acquire a write lock for a single object.
 * It is the user's responsibility (in callback) to release the lock.
 *
 * @param {String} objectPath is the filesystem path to the object.
 * @param {LockCallback} callback is called when the lock is obtained.
 */
exports.lockObject = function (objectPath, callback) {
  enterMutex( () => lockOneObject( objectPath, callback ) );
}

/** Release a previously acquired lock on an object.
 * @param {String} objectPath is the filesystem path to the object.
 */
exports.unlockObject = function (objectPath) {
  exitMutex();
  unlockOneObject( objectPath );
}

/** Acquire write locks for multiple objects.
 * It is the user's responsibility (in callback) to release the locks.
 *
 * @param {Array} objectPathArray is an array of filesystem paths to the objects.
 * @param {LockCallback} callback is called when the locks have been obtained.
 */
exports.lockObjects = function (objectPathArray, callback) {
  let lockNext = () => {
    if( objectPathArray.length===0 ){
      callback();
    } else {
      let oo = objectPathArray.pop();
      lockOneObject( oo, lockNext );
    }
  };
  objectPathArray = objectPathArray.slice(0);
  objectPathArray.sort();
  enterMutex( () => lockNext() );
}

/** Release previously acquired object locks.
 * @param {Array} objectPathArray is an array of filesystem paths to the objects.
 */
exports.unlockObjects = function (objectPathArray) {
  exitMutex();
  while (objectPathArray.length > 0) {
    unlockOneObject (objectPathArray.pop());
  }
}

/**
 * A callback function of no parameters that is called when all requested
 * locks have been acquired.
 * @callback LockCallback
 */
