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

/* This module implements a filesystem-based storage backend.
 *
 * All client access to these functions should be via the generic storage module.
 * Clients must not directly access this module.
 */
const debug = false;
if (debug) console.log('Loading storage backend filesystem');

const fs = require('fs-extra');
const fsp = require('fs').promises;
const spawn = require('child_process').spawn; // eslint-disable-line security/detect-child-process
const locks = require('./locks');

const repoPath = "/repo";

/* String used to separate path components.  May not occur in object ids.
 */
const pathSeparator = '/';
exports.pathSeparator = pathSeparator;

/* typeTab stores properties of the different object types */
var typeTab;

/* typeBasePathTab stores the base directory name for each type. */
var typeBasePathTab = {};

exports.initialize = function (isFinalStore, stageStorage) {
    // We may or may not be the final storage.
    // But we don't expect there to be stageStorage (except us).
    if (isFinalStore && stageStorage) {
        throw new Error ('storage-backend-filesystem cannot be behind stage storage');
    }
};

/* Return the collection ObjectAccessor for the userEmail and specialName.
 */
exports.getSpecialCollection = function (userEmail, specialName) {
    if (specialName && ["","home","clipboard","mailbox","trash"].indexOf( specialName ) < 0) {
        return null;
    }
    let cname = userEmail === 'public' ? 'public' : ('users' + pathSeparator + userEmail.toLowerCase());
    if (specialName && specialName !== '' && specialName !== 'home') {
        cname = cname + pathSeparator + specialName;
    }
    return exports.getObjectPath ('collection', cname);
};


/* Return a promise for an array of all registered users.
 *
 * Users have a 'home' directory that is a direct child of the 'users' collection.
 */
exports.listUsers = function ( searchStr ) {
    const P = exports.listSubobjects( exports.getObjectPath('collection', 'users') );
    if (searchStr && searchStr !== '') {
        return P.then(subobjects => subobjects.filter( (fn) => { return fn.indexOf( searchStr ) >= 0; } ));
    } else {
        return P;
    }
};


/* Remove any user collection ids that can get captured by
 * a deepclean, so we don't remove any user collections.
 *
 * Deepclean is only responsible for cleaning direct
 * children of the collections directory so the only
 * directory we need to be concerned about is 'users'.
 */
exports.removeUserCollections = function (collectionIds) {
    return collectionIds.filter(id => id !== 'users');
};


/* Return the path to the object with the specified objectType and objectId.
 * - objectType must be valid.
 * - objectId must be valid but need not exist.
 * The returned path is always terminated by a path separator ('/').
 */
exports.getObjectPath = function (objectType, objectId) {
    if (!objectType || !objectId || !typeBasePathTab[[objectType]]) {
        throw new Error(`cannot get object path for ${objectType}/${objectId}`);
    }
    return exports.getTypeAccessor(objectType).object(objectId);
};


/* Return a promise for an array of all files in the object.
 */
exports.getFilesInObject = function (objectPath, options) {
    options = options || {};
    return new Promise(function (resolve) {
	let allFiles = [];
	function scanDir (dir, thisScanDone) {
	    fs.readdir (objectPath+dir, { withFileTypes: true }, function (err, dirents) {
		if (debug) {
		    dirents.forEach((de, idx) => {
			if (debug) console.log ('' + idx + ': ' + dir + de.name + (de.isDirectory() ? "/" : (de.isFile() ? "" : "@")));
		    });
		}
		allFiles = allFiles.concat(dirents.filter(de=>de.isFile()).map(de=>dir+de.name));
		const subdirs = dirents.filter(de=>de.isDirectory()).map(de=>dir+de.name+pathSeparator);
		const tasks = subdirs.map(function(subdir) {
		    return new Promise((resolve) => {
			scanDir (subdir, resolve);
		    });
		});
		Promise.all(tasks)
		.then (thisScanDone);
	    });
	}
	scanDir ("", () => {
	    if (options.fullPaths) {
		allFiles = allFiles.map(f => objectPath + f);
	    }
	    resolve (allFiles);
	});
    });
};


/* Create the shaidyObject at objectPath and call next().
 * It is not an error if the object already exists.
 */
exports.makeObjectIfNeeded = function (objectPath, next) {
    if (debug) console.log ('makeObjectIfNeeded ' + objectPath);
    fs.mkdir (objectPath.path, () => {
        next();
    });
};


/* Only called if we are the main storage system.
 * No need/way to stage object.
 */
exports.stageOutIfNeeded = function (objectType, objectId) {
    if (debug) console.log ('fs.stageOutIfNeeded ' + objectType + '/' + objectId);
    return Promise.resolve(true);
}


/* Only called if we are the main storage system.
 * No need/way to stage object.
 */
exports.stageInIfNeeded = function (objectType, objectId) {
    if (debug) console.log ('fs.stageInIfNeeded ' + objectType + '/' + objectId);
    return Promise.resolve(true);
};


/* Return a promise to create the shaidyObject at objectPath.
 */
exports.createNewObject = function (objectPath, callback) {
    if (debug) console.log ('createNewObject ' + objectPath);
    return new Promise ((resolve, reject) => {
        fs.mkdir (objectPath.path, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve (true);
            }
        });
    });
}


/* Write content as JSON to the file at objectPath.
 */
exports.writeJSON = function ( objectPath, content ) {
    if (debug) console.log (Date.now() + ' > fs.writeJSON ' + objectPath);
    return objectPath.writeJSON(content);
};


/* Determine if the object at objectPath exists.
 * Non-directories at objectPath will return false.
 * callback/promise is passed one parameter: whether the object exists
 */
exports.objectExists = function (objectPath, callback) {
    if (debug) console.log ({ 'objectExists ': objectPath });
    if (callback) {
	fs.lstat (objectPath.path, function (err, stats) {
	    const objectValid = !err && stats.isDirectory();
	    // console.log ({ 'objectValid: ': objectValid, err , stats });
	    callback(objectValid);
	});
    } else {
	return fsp.lstat (objectPath.path).then (stats => stats.isDirectory());
    }
};


/* Determine if the file at filePath exists.
 * Non-files at objectPath will return false.
 * callback/promise is passed one parameter: whether the object exists and is a file.
 */
exports.fileExists = function (filePath, callback) {
    if (debug) console.log ('fileExists ' + filePath);
    if (callback) {
	fs.lstat (filePath.path, function (err, stats) {
	    const objectValid = !err && !stats.isDirectory();
	    callback(objectValid);
	});
    } else {
	return fsp.lstat (objectPath.path).then (stats => !stats.isDirectory());
    }
};


/* Find all subobjects of the object at objectPath.
 * callback takes two parameters:
 *  err, which is null iff no error
 *  subobjects, a vector of subobject identifiers
 */
exports.listSubobjects = function (objectPath, callback) {
    if (debug) console.log ('listSubobjects ' + objectPath);
    if (callback === undefined) {
        return new Promise ((resolve, reject) => {
            fs.readdir( objectPath.path, (err, files) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(files);
                }
            });
        });
    } else {
        fs.readdir( objectPath.path, callback);
    }
};


/* Create a temporary (local) object for an object at objectPath.
 * When complete, call callback with two parameters:
 *  - err, which must be null iff there was no error
 *  - tmpObjectPath, the name of the temporary folder for the object
 */
exports.createTempObject = function (typeName, objectId, callback) {
    if (debug) console.log ('fs.createTempObject ' + typeName + '/' + objectId);
    let objectPath = typeBasePathTab[[typeName]] + objectId;
    fs.mkdtemp (objectPath + '---', callback);
};


/* Move the object at tmpObjectPath (on the local filesystem) to
 * objectPath.  When complete, call callback with one parameter:
 *   err, which must be null iff no error occurred
 */
exports.moveTempObject = function (tmpObjectPath, typeName, objectId, callback) {
    if (debug) console.log ('moveTempObject ' + tmpObjectPath + ' -> ' + typeName + '/' + objectId);
    let objectPath = typeBasePathTab[[typeName]] + objectId;
    fs.rename (tmpObjectPath, objectPath, callback);
};


/* Permanently remove the temporary object at tmpObjectPath.
 */
exports.removeTempObject = function (tmpObjectPath) {
    spawn ('rm', ['-rf', tmpObjectPath]);
};


/* Return the direct URL for the object at objectPath.
 */
exports.getDirectURL = function (objectPath) {
    if (process.env.FILESYSTEM_DIRECT_URL && objectPath.substr(0,1) !== '/') {
        return process.env.FILESYSTEM_DIRECT_URL + objectPath;
    }
    else {
        return null;
    }
};

/* Respond by sending object at objectPath to caller.
 * Callback takes one parameter (err), which can be
 * either null or an error object with fields name and message.
 * Err must be null iff a response was sent.
 */
exports.sendFile = function (res, objectPath, callback) {
    if (debug) console.log ('sendFile ' + objectPath);
    res.sendFile (objectPath.path, callback);
};

/* Copy req.objectPath to temporary local storage, and
 * update req.objectPath to that location.
 *
 * We are already as local as possible.
 */
exports.localizeObject = function (req, res, next) {
    if (debug) console.log ('localizeObject ' + req.objectPath);
    next();
}


/* Delete the temporary local storage referenced by req.objectPath.
 *
 * We don't localize objects, so nothing to free.
 */
exports.freeLocalizedObject = function (req) {
    if (debug) console.log ('freeLocalizedObject ' + req.objectPath);
}


/* Extend req.tilepath to include appropriate extension.
 */
exports.selectTile = function (req, res, next) {
    /* 10/16/2018:
     * Send new .tile if present, otherwise look for deprecated .bin.
     * Perhaps remove after number of old .bin files drops. Rename
     * old .bin files to .tile. (Content hasn't changed, just the name.)
     */
    /* FIXME: fiddling object variables is not cool. */
    if (debug) console.log ('selectTile ' + req.tilepath);
    fs.lstat (req.tilepath.path + '.tile', function (err, stats) {
      if (!err && !stats.isDirectory()) {
        req.tilepath.path = req.tilepath.path + '.tile';
	next();
      } else {
	fs.lstat (req.tilepath.path + '.bin', function (err, stats) {
	  if (!err && !stats.isDirectory()) {
	    req.tilepath.path = req.tilepath.path + '.bin';
	    next();
	  } else {
            res.status(400).send('bad request: no such tile');
            return;
	  }
	});
      }
    });
}


/* Remove all of the given objIds (files) from the directory at objectPath.
 * Only removes files created before the given parameter.
 * Next is called after all the files have been removed.
 */
exports.removeOldObjects = function (objectPath, objIds, createdBefore, next) {

    if (debug) console.log ('removeOldObjects ' + objectPath);
    function removeOneObject(objids) {
        if (objids.length === 0) {
            next();
        } else {
            const thisFile = objectPath + objids[0];
            fs.stat( thisFile, (err, stats) => {
                if (!err && stats.birthtime < createdBefore) {
                    if (debug) console.log( 'Removing ' + thisFile );
                    fs.remove( thisFile, (err) => {
                        if (err) console.log( 'Error removing ' + thisFile );
                        removeOneObject( objids.slice(1) );
                    } )
                } else {
                    if (debug) console.log( 'Not removing ' + thisFile );
                    removeOneObject( objids.slice(1) );
                }
            } );
        }
    }

    objectPath = objectPath.path + pathSeparator;
    removeOneObject( objIds );
}


/* Return the path to the local repository.
 */
exports.getLocalRepoPath = function () {
    return repoPath;
}


/* Return the contents of the file at objectPath, either as a
 * promise or via a callback.
 */
exports.readFile = function (objectPath, callback) {
    if (debug) console.log ('readFile ' + objectPath);
    if (callback !== undefined) {
        objectPath.readFile( callback );
    } else {
        return new Promise((resolve,reject)=>{ // eslint-disable-line no-unused-vars
            objectPath.readFile( (err, data) => {
                if (err) {
                   reject(err);
                } else {
                   resolve(data);
                }
            } );
        });
    }
}


/* Write content to the file at objectPath.  Call callback on completion.
 */
exports.writeFile = function (objectPath, content, callback) {
    if (debug) console.log ('writeFile ' + objectPath);
   fs.writeFile( objectPath.path, content, callback );
}

/* Create a typeBasePathTab from a typeTab.
 */
function createBasePathTab (typeTab) {
    const typeBasePathTab = {};
    typeTab.forEach (function (typeInfo) {
      if (typeInfo.Path[0] === pathSeparator) {
	typeBasePathTab[[typeInfo.Type]] = typeInfo.Path + pathSeparator;
      } else {
	typeBasePathTab[[typeInfo.Type]] = repoPath + pathSeparator + typeInfo.Path + pathSeparator;
      }
      if (false && debug) console.log( 'typeBasePathTab[[' + typeInfo.Type + ']]=' + typeBasePathTab[[typeInfo.Type]]);
   });
   return typeBasePathTab;
}


/* Create a new typeTab.
 *
 * We just include every type we need to know about.
 */
function createNewTypeTab() {
    const knownObjectTypes = [
        'collection', 'compendium',
        'dataset', 'dendrogram',
        'label', 'tile', 'file',
        'chm', 'viewer'
    ];
    return knownObjectTypes.map(t => ({ Type: t, Path: t }));
}

/* Create a new filesystem repository, and return a Promise of completion.
 *
 * Only succeeds if:
 * - the directory already exists,
 * - the directory is empty,
 * - we can create the new typeTab.json file in directory.
 *
 * FIXME: also create the type folders.
 */
function createNewRepository () {
    return new Promise((resolve,reject) => {
	fs.readdir( repoPath, (err, files) => {
	    if (err) {
		console.log ('fs.createNewRepository: cannot access repository');
		console.error (err);
		reject (err);
	    } else if (files.length > 0) {
		console.log ('fs.createNewRepository: typeTab.json does not exist but repository is not empty');
		reject (new Error('invalid repository'));
	    } else {
		typeTab = createNewTypeTab();
		fs.writeFile( repoPath + '/typeTab-new.json', JSON.stringify(typeTab), (err) => {
		    if (err) {
			console.log ('fs.createNewRepository: repository empty but unable to create new typeTab');
			console.error (err);
			reject (err);
		    } else {
			console.log ('fs.createNewRepository: repository empty: created new typeTab');
			typeBasePathTab = createBasePathTab(typeTab);
			resolve ();
		    }
		});
	    }
	});
    });
}


/* Initializes the storage system and returns a Promise of completion.
 *
 * For the filesystem backend, this involves loading or creating the typeTab.json file.
 */
exports.initializeStorageSystem = function () {
    return new Promise ((resolve, reject) => {
	fs.readFile(repoPath + "/typeTab.json", "utf8", function (err, data) {
	    if (err) {
		console.log ('fs.initializeStorageSystem: cannot read typeTab.json');
		console.error (err);
		reject (err);
	    } else {
		typeTab = JSON.parse(data);
		typeBasePathTab = createBasePathTab(typeTab);
		resolve ();
	    }
	});
    })
    .catch (err => {
	if (err & err.name==='Error' && err.code === 'ENOENT') {
	    return createNewRepository ();
	} else {
	    throw err;
	}
    });
};


/* Return true iff the string objectType is a valid type name.
 */
exports.isValidType = function (objectType) {
    return typeBasePathTab.hasOwnProperty (objectType);
}


/* Return an array of all valid object types.
 */
exports.listTypes = function() {
    return typeTab.map(function(ee){return ee.Type});
}

/**************************************************************************/

class Accessor {
    constructor (path) {
        //console.log ('Constructing Accessor for path ' + path);
        if (!path) {
            console.log('Accessor path is null or undefined');
            throw new Error('Accessor path is null or undefined');
        }
        this.path = path;
    }
    toString() {
        return ('[Accessor : ' + this.path + ']');
    }
}

class FileAccessor extends Accessor {
    constructor (type, path) {
        super(path);
        this.type = type;
    }
    toString() {
        return ('[FileAccessor : ' + this.path + ']');
    }
    readFile (callback) {
        fs.readFile (this.path, "utf8", callback);
    }
}

class JsonFileAccessor extends Accessor {
    constructor (type, path) {
        super(path);
        this.type = type;
    }
    toString() {
        return ('[JsonFileAccessor : ' + this.path + ']');
    }
    readFile (callback) {
        fs.readFile (this.path, "utf8", (err, data) => {
            callback (err, err ? null : JSON.parse(data));
        });
    }
    writeJSON (content) {
        if (debug) console.log ('writeJSON: ' + this.path + ':');
        if (debug) console.log (content);
        return new Promise ((resolve, reject) => {
            fs.writeFile( this.path, JSON.stringify(content), (err, data) => {
                if (err) {
		    console.log ('writeJSON: ' + this.path + ': failed');
		    console.error (err);
                    reject (err);
                } else {
		    if (debug) console.log ('writeJSON: ' + this.path + ': succeeded');
		    if (debug) console.log (data);
                    resolve (data);
                }
            });
        });
    }
}

class ObjectAccessor extends Accessor {
    constructor (type, path) {
        super(path);
        this.type = type;
    }
    toString() {
        return ('[ObjectAccessor : ' + this.path + ']');
    }

    object (id) {
        return new ObjectAccessor (this.type, this.path + id + pathSeparator);
    }

    file (name) {
        return new FileAccessor (this.type, this.path + name);
    }
    json (name) {
        return new JsonFileAccessor (this.type, this.path + name + '.json');
    }
}

class TypeAccessor extends Accessor {
    constructor (type) {
        if (debug) console.log ('Constructor TypeAccessor for type ' + type);
        //console.log (typeBasePathTab);
        super (typeBasePathTab[[type]]);
        this.type = type;
    }

    toString() {
        return ('[TypeAccessor : ' + this.type + ' => ' + this.path + ']');
    }

    object (id) {
        return new ObjectAccessor (this.type, this.path + id + pathSeparator);
    }

    json (name) {
        return new JsonFileAccessor (this.type, this.path + name + '.json');
    }
}


/* Return the base path for all objects of the specified objectType.
 * - objectType must be valid.
 * The returned path is always terminated by a path separator ('/').
 */
exports.getTypeAccessor = function (objectType) {
    return new TypeAccessor (objectType);
}

/* Open the specified matrix file for line-based reading.
 * The callback function is passed two parameters:
 * - err, which is non-null iff the file could not be opened.
 * - fd, an opaque file object to be passed to subsequent calls to
 *   closeMatrixFile and getLine.
 */
exports.openMatrixFile = function (fileName, callback) {
    if (debug) console.log ('openMatrixFile ' + fileName);
    fs.open( fileName.path, "r", (err, fd) => {
        if (err) {
            callback (err, null);
        } else {
            /* Lock access to the file so that concurrent reads
             * do not alter the seek position.
             */
            locks.lockObject( fileName.path, () => {
                callback (null, fd);
            });
        }
    });
}


/* Close the specified matrix file for line-based reading.
 * - fileName is the same name that was passed to openMatrixFile
 * - fd is the corresponding opaque file object from openMatrixFile
 */
exports.closeMatrixFile = function (fileName, fd) {
    if (debug) console.log ('closeMatrixFile ' + fileName);
    locks.unlockObject( fileName.path );
    fs.close( fd, () => {} );
}


/* Read one line from an open matrix file:
 * - tsvFd is an opaque file object from openMatrixFile
 * - offset is the offset in bytes from which to start reading
 * - callback is called when the data is available.
 * Callback takes two parameters:
 * - err, which is non-null iff an error occurred
 * - line, which is only valid if err===null.
 */
exports.getLine = function (tsvFd, offset, callback) {
	const bufferSize = 4096;
	var buf = Buffer.alloc(bufferSize);

	function getNextBuf (position, resultLine) {
	    fs.read( tsvFd, buf, 0, 1, position, (err, nbytes, buf) => {
		if (err) {
		    callback( err, undefined );
		} else {
		    let tempString = buf.slice(0,nbytes).toString('ascii');
		    let idx = tempString.indexOf('\n');
		    let eol = false;
		    if (idx >= 0) {
			tempString = tempString.substr(0,idx);
			eol = true;
		    }
		    idx = tempString.indexOf('\r');
		    if (idx >= 0) {
			// \r was found before, or instead of, \n.
			tempString = tempString.substr(0,idx);
			eol = true;
		    }
		    resultLine = resultLine + tempString;
		    if (eol) {
			callback( null, resultLine + '\n' );
		    } else {
			getNextBuf( position+nbytes, resultLine );
		    }
		}
	    });
	}

	getNextBuf(offset, '');
};

/* Return the path to the object with the specified objectType and objectId.
 * - objectType must be valid.
 * - objectId must be valid but need not exist.
 * The returned path is always terminated by a path separator ('/').
 */
exports.getObjectPath = function (objectType, objectId) {
    if (!objectType || !objectId || !typeBasePathTab[[objectType]]) {
        throw new Error(`cannot get object path for ${objectType}/${objectId}`);
    }
    return exports.getTypeAccessor(objectType).object(objectId);
};

/* Return the direct URL for the object at objectPath.
 */
exports.getDirectURL = function (objectPath) {
    if (process.env.FILESYSTEM_DIRECT_URL &&
        objectPath.substr(0,1) !== '/') {
        return process.env.FILESYSTEM_DIRECT_URL + objectPath;
    }
    else {
        return null;
    }
}

if (debug) console.log('Storage backend filesystem loaded');
