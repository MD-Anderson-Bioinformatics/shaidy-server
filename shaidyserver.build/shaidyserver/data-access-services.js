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
/*eslint security/detect-non-literal-fs-filename: "off" */
/*eslint security/detect-object-injection: "off" */

/**
 * A node.js capable version of "tsvio" - Indexed retrieval of rows from TSV files +
 * other functions supporting stat-toolbox
 *
 * @module data-access-services
 */

const debug = true;

const Promise  = require('promise');
const storage  = require('./storage');
const cache  = require('./cache');
const shaidyRepo = require('./shaidyrepo');
const routeUtils = require('./route-utils');

/* Recursively scan a javascript object to find all subobjects named key that
 * also contain a type field that equals the given type.
 *
 * It is assummed that these subobjects will all be shaids of the given type.
 *
 * Example: getShaids (obj, 'data', 'dataset') will match all shaids in obj
 * that look like { ...., data: { ..., type: 'dataset', value: 'foo' } }.
 *
 * Returns an array of sortable strings for all the shaid ids in the matching subobjects.
 */
function getShaids(obj, key, type) {
    let shaids = [];
    for (let i in obj) {
        if (!obj.hasOwnProperty(i)) continue;
        if (typeof obj[i] === 'object') {
            if (i!==key) {
                shaids = shaids.concat(getShaids(obj[i], key, type));
            }
            else if (obj[key]['type']===type){
                shaids.push('D:/'+type+'/'+obj[key]['value']+'/');
            }
        }
    }
    return shaids;
}


/* Return a promise for an array of all the CHM shaids in the specified collection.
 */
function get_CHMs_in_collection (collectionID) {
    const chms_path = storage.getObjectPath('collection', collectionID).json('chms');
    return cache.getObject (chms_path, []);
}

/* Returns a promise for an array of all the subobjects in a chm.
 */
function get_objects_in_chm (chm_shaid) {
    const chmjson_path = storage.getObjectPath('chm', chm_shaid).json('chm');
    return cache.getObject(chmjson_path)
    .then(chm => {
	return getShaids (chm, "data", "dataset")
	       .concat (getShaids (chm, "dendrogram", "dendrogram"))
	       .concat (getShaids (chm, "labels", "label"));
    });
}

// Return an array of sortable strings for all the shaids in the CHM with
// id chmId that must be available to successfully render the chm.
// Specifically, that includes:
// - the chm object itself,
// - all data:datasets, dendrogram:dendrograms, and labels:labels.
function getObjectsForRender (chmId) {
    if (debug) console.log ('getObjectsForRender ' + chmId);
    return new Promise((resolve,reject)=>{ // eslint-disable-line no-unused-vars
        var all_files = ["B:/chm/"+chmId+"/"];
        step1 (chmId);

        function step1(chmId) {
	    if (debug) console.log ('getObjectsForRender.step1 ' + chmId);
            /* 1. Determine all unique subobjects contained in the chm. */
	    get_objects_in_chm (chmId).then((subObjects) => {
	        step2 (Array.from(new Set(subObjects)));
            })
            .catch((error) => {
                reject(error);
            });
        }

        function step2(subObjects) {
	    if (debug) console.log ('getObjectsForRender.step2 ' + chmId);
	    all_files = all_files.concat (subObjects);
	    all_files = all_files.map((path) => { let f = path.split('/'); return f[1] + '/' + f[2]});
	    if (debug) console.log ('getObjectsForRender.resolve ' + chmId);
	    resolve (all_files);
	}
    });
}

function getPaths(req,res,next){

    var all_files = ['E:typeTab.json'];
    step1();

    function step1() {
        /* 1. Determine all unique collections in the DAG rooted at req.objectId. */
	function nodeFn (result, collectionId, resume) {
	    if (debug) console.log('Scanning collection/' + collectionId);
	    resume (null, result);
	};

	shaidyRepo.scanDAG (nodeFn, [], [req.objectId], (err, collectionIds, result) => {
            if (err) {
                res.status(500).send('Error scanning collection');
            } else {
                step2 (collectionIds);
            }
        });
    }

    function step2(collectionIds) {
        /* 2a. Append entries for each collection to all_files. */
	all_files = all_files.concat(collectionIds.map((collectionId) => ("A:/collection/"+collectionId+"/")));

        /* 2b. Determine all unique chms contained in those collections. */
	const tasks = collectionIds.map( (collectionId) => get_CHMs_in_collection (collectionId) );
	Promise.all(tasks)
	.then((chmIdVecs) => {
	    const chmIds = chmIdVecs.reduce((acc,cv)=>acc.concat(cv));
	    step3 (Array.from(new Set(chmIds)));
        });
    }

    function step3(chmIds) {
        /* 3a. Append entries for each chm to all_files. */
	all_files = all_files.concat(chmIds.map((chmId) => ("B:/chm/"+chmId+"/")));
	all_files = all_files.concat(chmIds.map((chmId) => ("C:/viewer/"+chmId+"/")));

        /* 3b. Determine all unique subobjects contained in those chms. */
	const tasks = chmIds.map( (chmId) => get_objects_in_chm (chmId) );
	Promise.all(tasks)
	.then((res_files) => {
	    const subObjects = res_files.reduce((acc,cv)=>acc.concat(cv));
	    step4 (Array.from(new Set(subObjects)));
        });
    }

    function step4(subObjects) {
        /* 4a. Append entries for each subobject to all_files. */
	all_files = all_files.concat (subObjects);

        /* 4b. Sort all_files and remove sort prefix. */
	all_files.sort();
	all_files.reverse();
	all_files = all_files.map((path) => path.split(":")[1]);

        /* 4c. Call next(). */
	req.files_list = all_files;
        next();
    }
}


/**
 * Converts a route of the form .../dataset/:dsid into a route of
 * the form .../chm/:chmid/:name, interpreted as the dataset called
 * name in the CHM chmid.
 *
 * The first parameter is the function that implements the route for
 * the specified dataset.
 *
 * This function looks up the dataset by name in the specified CHM,
 * modifies the object path to reference that dataset, and calls the
 * dataset route function (i.e. the first parameter).
 *
 * This function always returns a 404 error if a dataset with the specified
 * name is not attached to the specified CHM and the dataset route function
 * is not called.
 */
function accessDatasetViaCHM (datasetFinalWare, req, res) {
    cache.getObject(req.objectPath.json("chm"))
    .then(data => {
        const datasets = data.datasets;
        const theOne = datasets && datasets.find(elem => elem.name === req.datasetName);
        if (theOne) {
	    req.objectPath = req.datasetsPath.object(theOne.data.value);
	    datasetFinalWare (req, res);
        } else {
	    console.log ('No dataset with that name');
	    res.status(404).send();
        }
    })
    .catch(err => {
	console.log ('No chm with that name');
	res.status(404).send();
    });
}

// Send the row labels of the object in req to the client.
//
function getRowLabels (req, res) {
    cache.getIndex(req.objectPath.file("index.tsv"))
    .then(index => {
        const keys = Object.keys(index);
        res.status(200).json({ data: keys });
    })
    .catch(err => {
        res.status(500).send('index not found');
    });
}

function getRowLabels2 (req, res) {
    accessDatasetViaCHM (getRowLabels, req, res)
}

function getByLabels (req, res) {

  // Get index via cache.
  cache.getIndex( req.objectPath.file("index.tsv"))
  .then(index => {

    // Read lines in tsvFd matching each label in labels
    // and write each line to response.
    // Call responseDone when all lines for all labels sent.
    function sendSelected (tsvFd, labels, responseDone) {

      // Recursively send remaining data lines.
      function sendRemainingLabels (positions) {
        if (positions.length > 0) {
          storage.getLine( tsvFd, positions.shift(), (err, resultLine) => {
            if (err) {
	      console.log ({ m: 'Error readline data line', err });
	      sendRemainingLabels( positions );
	    } else if (res.write(resultLine)) {
	      sendRemainingLabels( positions );
	    } else {
	      if (debug) console.log( 'res.write returned should wait' );
	      res.socket.once ('drain', () => sendRemainingLabels( positions ));
            }
          });
        } else {
          responseDone();
        }
      }

      function sendHeaderLine ( next ) {
	storage.getLine ( tsvFd, 0, (err, resultLine) => {
	  if (err) {
	    console.log ({ m: 'Error readline data line', err });
	    next (err);
	  } else if (res.write( resultLine )) {
	    next (null);
	  } else {
	    if (debug) console.log( 'res.write returned should wait on header' );
	    res.socket.once ('drain', () => next(null));
	  }
	});
      }

      sendHeaderLine ( (err) => {
	if (!err) {
	  // Split labels at commas, look up indices, exclude missing.
	  const positions = (labels ? labels.split(',') : []).map(l => index[l]).filter(l => !!l);
	  // Send lines beginning at each unique position.
	  sendRemainingLabels( positions.filter((x,i,a) => a.indexOf(x) === i).sort() );
	}
      });
    }

    const matrixFile = req.objectPath.file("matrix.tsv");
      storage.openMatrixFile (matrixFile, (err, tsvFd) => {
        if (err) {
          res.status(500).send( 'dataset not accessible' );
        } else {
	  res.socket.on ('error', (err) => {
	    console.log ({ m: 'Error sending response', err });
	    // Not sure what else we can do.
	  });
          res.writeHead( 200, {'Content-Type': 'text/plain'} );
          sendSelected (tsvFd, req.query.labels, () => {
              res.end();
              storage.closeMatrixFile (matrixFile, tsvFd);
          });
        };
      });
  })
  .catch( err => {
      res.status(500).send('index not found');
  });
}

function getByLabels2 (req, res) {
    accessDatasetViaCHM (getByLabels, req, res)
}

function sha_getdatasetdesc (req, res) {
// --> a string
//
// from chm.json:   "data" -> "datasets" -> "description" (where "name" = datasetName)
//
// http://192.168.99.100:8188/api/prop/chm/chm/568bf58a2128f7cee1698e03a0f43a22b293d483

    cache.getObject(req.objectPath.json("chm"))
    .then(data => {
	const datasets = data.datasets;
	const theOne = datasets && datasets.find (elem => elem.name === req.datasetName);
	if (theOne) {
	    if (theOne.description) {
		const result = theOne.description;
		res.end (result);
	    } else {
		console.log ('NOT theOne.description');         // returns what ?
		res.end ('');
	    }
	} else {
	    console.log ('No dataset with that name');
	    res.status(404).send();
	}
    })
    .catch(err => {
	console.log ('No chm with that name');
	res.status(404).send();
    });
}


function sha_getsampleseries (req, res) {
//
//  Sample      Series  Covariate
// TCGA-02-0003 default none
// TCGA-02-0004 default none
// TCGA-78-7146 WT      mut.egfr
// TCGA-78-7147 WT      mut.egfr
//
    function sendAllCovars (covars, next) {

	function sendRemainingCovars (covars) {
	    if (covars.length > 0) {
		const covar = covars.shift(),
		      label = covar[0],
		      path = req.datasetsPath.object(covar[1]).file('matrix.tsv');

		storage.readFile (path, function (err, str) {
		    if (err) {
			console.log ('Error reading ' + path + ': ' + err);
                        next();
		    } else {
			var data = str.split ('\n');
			data = data.slice(1);           // discard first (header) line;
			data = data.join ('\t' + label + '\n');

			if (res.write(data)) {
			    sendRemainingCovars (covars);
			} else {
			    if (debug) console.log( 'res.write returned should wait' );
	                    res.socket.once ('drain', () => sendRemainingCovars( covars ));
			}
		    }
		});
	    } else {
		next();
	    }
	}

	sendRemainingCovars (covars);
    }

    res.socket.on ('error', (err) => {
      console.log ({ m: '.error sending response', err });
    });
    cache.getObject(req.objectPath.json("chm"))
    .then(data => {
	const datasets = data.datasets;
	const theOne = datasets && datasets.find (elem => elem.name === req.datasetName);
	if (theOne) {
	    const header = 'Sample\tSeries\tCovariate\n';
	    const covars = theOne['column.covariates'] || [];
	    res.write (header);
	    sendAllCovars( covars.map (elem => [elem.label, elem.data.value]),
			   () => res.end() );
	} else {
	    console.log ('No dataset with that name');
	    res.status(404).send();
	}
    })
    .catch(err => {
	console.log ('No chm with that name');
	res.status(404).send();
    });
}


//
// Covariate    Series  Description     Color   Shape   zIndex
// none default Samples black   circle  10
// none regression      Regression      red     line    11
// mut.tp53     WT      Wild type       #777777 circle  9
// mut.tp53     MUT     Mutated red     triangle        10
// mut.tp53     unspecified     Unspecified     black   triangle-down   8
// mut.tp53     regression      Regression      red     line    11
// mut.pik3ca   WT      Wild type       #777777 circle  9
//
//});
function sha_getseriesproperties (req, res) {

    cache.getObject(req.objectPath.json("chm"))
    .then(data => {

	const datasets = data.datasets;
	const theOne = datasets && datasets.find (elem => elem.name === req.datasetName);
	if (theOne) {
	    const result = [ "Covariate\tSeries\tDescription\tColor\tShape\tzIndex\n" ];
	    const covars = theOne['column.covariates'] || [];
	    const renderers = data.covariate_renderers;

	    covars.forEach (function (covar) {
		const theRenderer = renderers[covar.renderer];
		theRenderer.points.forEach ( (point) => {
		    // Format as a tab delimited line
		    result.push([covar.label, point.value, point.name, point.color,
				 point.shape, point.z].join('\t') + '\n');
		});
	    });
	    res.end (result.join(''));
	} else {
	    console.log ('No dataset with that name');
	    res.status(404).send();
	}
    })
    .catch(err => {
	console.log ('No chm with that name');
	res.status(404).send();
    });
}


function sha_getcovardescriptions (req, res) {
//
// Covariate    Fullname
// none Nothing
// mut.tp53     TP53 mutation
// mut.pik3ca   PIK3CA mutation
// mut.pten     PTEN mutation
//
// from chm.json:   "data" -> "datasets" -> "column.covariates" -> "label" + "fullname"

    cache.getObject(req.objectPath.json("chm"))
    .then(data => {

	const datasets = data.datasets;
	const theOne = datasets && datasets.find (elem => elem.name === req.datasetName);
	if (theOne) {
	    const result = [ "Covariate\tFullname\n" ];
	    const covars = theOne['column.covariates'] || [];
	    covars.forEach (function (elem) {
		result.push (elem.label + '\t' + elem.fullname + '\n');
	    });
	    res.end (result.join(''));
        } else {
	    console.log ('No dataset with that name');
	    res.status(404).send();
        }
    })
    .catch(err => {
	console.log ('No such chm');
	res.status(404).send();
    });
}

function defineDataAccessRoutes (app) {
    // Path parameter dsid is the sha id of a dataset in the repository
    app.param ('dsid', function (req, res, next, id) {
        console.log ('param(dsid) dsid=' + id);
        req.datasetName = id;
        req.datasetsPath = storage.getTypeAccessor('dataset');
        next ();
    });

    /**Return list of file paths in the collection for rsync
     * @routeparam {String} :type must be collection
     * @routeparam {String} objid is the shaid of collection
    */
    app.get('/api/collection_paths/:type/:objid', getPaths, function(req,res){
	  if (req.accepts("application/json")){
	    if (debug) console.log("json")
	    res.status(200).json(req.files_list)
	  }
	  else if (req.accepts("text/plain")){
	    if (debug) console.log("txt")
	    res.status(200)
	    res.setHeader('Content-disposition', 'attachment; filename=collection_paths.txt');
	    res.setHeader('Content-type', 'text/plain');
	    res.charset = 'UTF-8';
	    res.write(req.files_list.join("\n"));
	    res.end();
	  }else {
	    res.status(404).send("The 'Accept' in HEADER should be application/json or text/plain.")
	  }
    });
    /** Get dataset rowlabels
     * Response is text/json.
     * The response consists of all rowlabels in the dataset.
     * @name Get Dataset Rowlabels
     * @route {GET} /api/rowlabels/dataset/:objid
     * @authentication Not required.
     * @routeparam {String} objid is the shaid of the dataset being queried.
     */
    app.get ('/api/rowlabels/:type/:objid', routeUtils.isDataset, routeUtils.objectExists, getRowLabels);
    app.get ('/api/rowlabels/:type/:objid/:dsid', routeUtils.isCHM, routeUtils.objectExists, getRowLabels2);

    /** Get dataset collabels
     * Response is text/json.
     * The response consists of all collabels in the dataset.
     * @name Get Dataset Collabels
     * @route {GET} /api/collabels/dataset/:objid
     * @authentication Not required.
     * @routeparam {String} objid is the shaid of the dataset being queried.
     */
    //app.get ('/api/collabels/:type/:objid', routeUtils.isDataset, routeUtils.objectExists, getColLabels);
    //app.get ('/api/collabels/:type/:objid/:dsid', routeUtils.isCHM, routeUtils.objectExists, getColLabels2);

    /** Get dataset rows by label
     * Response is text/plain.
     * The response consists of all lines in the dataset that begin with one of
     * the labels in the request.
     * @name Get Dataset Data
     * @route {GET} /api/bylabel/dataset/:objid
     * @authentication Not required.
     * @routeparam {String} objid is the shaid of the dataset being queried.
     * @queryparam {String} labels is a comma-separated list of row labels.
     */
    app.get ('/api/bylabel/:type/:objid', routeUtils.isDataset, routeUtils.objectExists, getByLabels);
    app.get ('/api/bylabel/:type/:objid/:dsid', routeUtils.isCHM, routeUtils.objectExists, getByLabels2);

    /** "dataAccessServices" api to support stat toolbox
     * @name Get Series Names
     * @route {GET} /api/getseriesnames
     * @authentication Not required.
     */
    app.get ('/api/sha_getdatasetdesc/:type/:objid/:dsid', routeUtils.isCHM, routeUtils.objectExists, sha_getdatasetdesc);
    app.get ('/api/sha_getsampleseries/:type/:objid/:dsid', routeUtils.isCHM, routeUtils.objectExists, sha_getsampleseries);
    app.get ('/api/sha_getcovardescriptions/:type/:objid/:dsid', routeUtils.isCHM, routeUtils.objectExists, sha_getcovardescriptions);
    app.get ('/api/sha_getseriesproperties/:type/:objid/:dsid', routeUtils.isCHM, routeUtils.objectExists, sha_getseriesproperties);
}


module.exports = {
	defineDataAccessRoutes,
        getObjectsForRender
};
