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

// This module implements the 'seaview' system for viewing compendiums.

const debug = false;

const cors = require('cors');
const storage = require('./storage');
const cache = require('./cache');

const mapPublicId = require('./publicnames').mapPublicId;

const seaviewThemeBase = process.env.SEAVIEW_THEME_BASE || "/seaview-themes";
const viewerURL = process.env.NGCHM_VIEWER_URL || "/NGCHM/chm.html";

console.log ('NGCHM_VIEWER_URL is ' + viewerURL);
console.log ('SEAVIEW_THEME_BASE is ' + seaviewThemeBase);

function failIfNotAuthorized (req, res, next) {
    if (!req.seaviewAuthorized) {
        res.status(403).send();
    } else {
        next();
    }
}

const checkRequestToken = require('./authenticate').checkRequestToken;

function checkSeaviewAuthorization (req, res, next) {
    if (debug) console.log ('Checking Seaview Authorization');
    const cfg = req.seaviewConfig;
    checkRequestToken (cfg.authenticators, req, res, () => {
	if (debug) console.log ('User profile');
	if (debug) console.log (req.user);
	if (Object.keys(cfg.authenticators||{}).length > 0 && !req.user) {
	    /* At least authenticator specified but req is not authenticated. */
	    next();
	    return;
	}
	if (debug) console.log ('Authorized users');
	if (debug) console.log (cfg.authorizedUsers);
	if ((cfg.authorizedUsers||[]).length > 0) {
            if (!req.user) {
	        /* At least authorized user specified but req is not authenticated. */
	        next();
	        return;
            }
	    const mail = req.user.mail || req.user.email ;
	    if (!mail || cfg.authorizedUsers.indexOf (mail.toLowerCase()) < 0) {
                /* User email not in authorized user list. */
	        next();
	        return;
            }
        }

        /* No concerns detected. */
	req.seaviewAuthorized = true;
	if (debug) console.log ('Seaview Authorization Passed');
	next();
    });
}

const seaviewFieldName = 'compendium';

function loadSeaviewConfig (req, res, next) {
    cache.getObject (req.objectPath.json(seaviewFieldName))
    .then(data => {
	if (!data.theme) {
	    if (debug) console.log ('seaview config - no theme:');
            if (debug) console.log (data);
	    res.status(500).send('view misconfigured');
        } else {
            req.seaviewConfig = data;
            next();
        }
    })
    .catch(err => {
	res.status(404).send('no such view');
    });
}

var seaviewCache = {};

function loadSeaviewCollection (req, res, next) {

    if (debug) console.log ({ m: 'loading seaview collection', config: req.seaviewConfig });
    const filters = req.seaviewConfig.collections.map(c => new RegExp(c.selector));
    if (debug) console.log ({ m: 'Found ' + filters.length + ' collection selectors', filters });

    function propVal (chm, propName) {
        const p = chm.properties.filter(p => p.label === propName);
        return p.length === 0 ? "" : p[0].value;
    }

    function addChmToCollection (mapinfo) {
        if (debug) console.log ('Adding ' + mapinfo.name + ' to collection');
        for (let idx in filters) {
            if (filters[idx].test(mapinfo.name)) {
                if (debug) console.log ('Assigning ' + mapinfo.name + ' to collection ' + idx);
                //console.log (req.seaviewCollection[idx]);
                if (!req.seaviewCollection[idx].hasOwnProperty(mapinfo.name)) {
		    /* First map with that name. */
                    req.seaviewCollection[idx][mapinfo.name] = mapinfo;
                } else {
                    const olddate = req.seaviewCollection[idx][mapinfo.name].buildDate;
                    if (isNaN(mapinfo.buildDate) ||
                        (!isNaN(olddate) && mapinfo.buildDate < olddate)) {
                        /* Current map is 'older', append to existing entry's older maps. */
                        req.seaviewCollection[idx][mapinfo.name].olderMaps.push(mapinfo);
                    } else {
                        /* Current map is 'newer'. Move existing entry to olderMaps. */
                        mapinfo.olderMaps = req.seaviewCollection[idx][mapinfo.name].olderMaps;
                        req.seaviewCollection[idx][mapinfo.name].olderMaps = null;
                        mapinfo.olderMaps.push (req.seaviewCollection[idx][mapinfo.name]);
                        req.seaviewCollection[idx][mapinfo.name] = mapinfo;
                    }
                }
                return;
            }
        }
    }

    function vectorize (obj) {
        const vec = [];
        for (let idx in obj) {
            if (obj.hasOwnProperty(idx)) {
                vec.push(obj[idx]);
            }
        }
        return vec;
    }

    function loadChmDetails (chms) {

        if (debug) console.log ('Loading ' + chms.length + ' chms.');

        /* Create promises for storing the details of all the chms. */
        const tasks = chms.map(function (chmid) {
            return cache.getObject (storage.getObjectPath('chm', chmid).json("chm"))
                .then (function(chm) {
		    //console.log ('loadChmDetails: loaded chm/' + chmid);
		    const buildDate = new Date(propVal(chm,"chm.info.build.time"));
                    let path = storage.getDirectURL ('viewer/' + chmid);
                    let thumb;
                    if (path) {
			thumb = `${path}/${chm.name}/tn.png`;
                    } else {
                        // FIXME: assumes api is at /api.
                        path = `/api/file/viewer/${chmid}`;
			thumb = `${path}/${chm.name}/tn.png`;
                    }
		    const mapinfo = {
			id: chmid,
			name: chm.name,
			properties: chm.properties,
			caption: propVal(chm,"chm.info.caption"),
			buildDate: buildDate,
			thumb: thumb,
			olderMaps: []
		    };
		    addChmToCollection (mapinfo);
		    return true;
		})
		.catch (function(err) {
		    if (debug) console.log ('loadChmDetails: Error getting chm/' + chmid);
		    if (debug) console.log (err);
		    return true;
		});
        });

        Promise.all(tasks)
        .then (function() {
            if (debug) console.log ('loadChmDetails: In Promise.all');
            req.seaviewCollection = req.seaviewCollection.map(obj => vectorize(obj));
            /* maxAge specifies time in minutes before cached entry expires (default: 10 minutes) */
            //let expiresAt = Date.now() + (req.seaviewConfig.maxAge ? + req.seaviewConfig.maxAge : 10) * 60000;
            const expiresAt = Date.now() + 1;
            seaviewCache[[req.objectId]] = new Object({ entry: req.seaviewCollection, expiresAt: expiresAt });
            if (debug) {
                 console.log ('loadChmDetails: ' + req.objectId);
                 //console.log (seaviewCache[[req.objectId]]);
            }
            next();
        })
        .catch (function(err) {
            if (debug) console.log ('loadChmDetails: Error at Promise.all');
	    if (debug) console.log (err);
            res.status(500).send();
        });
    }

    const fromCache = seaviewCache[[req.objectId]];
    if (fromCache && Date.now() < fromCache.expiresAt) {
        req.seaviewCollection = fromCache.entry;
        next();
        return;
    }

    const collectionPath = storage.getObjectPath('collection', req.seaviewConfig.mapsCollection);

    cache.getObject (collectionPath.json('chms'))
    .then (data => {
	req.seaviewCollection = (req.seaviewConfig.collections||[]).map(c => new Object());
	loadChmDetails (data);
    })
    .catch(err => {
        if (debug) console.log('Error loading compendium chms from ' + collectionPath);
        console.error (err);
	req.seaviewCollection = (req.seaviewConfig.collections||[]).map(c => new Object());
	loadChmDetails ([]);
    });
}

function genScriptTag (properties, content) {
    properties = Object.assign ({ type: 'application/javascript' }, properties);
    const tp = nm => properties[nm] === undefined ? nm : nm + "='" + properties[nm] + "'";
    let tag = `<script ${Object.keys(properties).map(tp).join(' ')}>`;
    if (content !== undefined) tag = tag + '\n' + content + '\n';
    return tag + '</script>\n';
}


function genMetaTag (properties, content) {
    properties = Object.assign ({}, properties);
    const tp = nm => properties[nm] === undefined ? nm : nm + "='" + properties[nm] + "'";
    return `<meta ${Object.keys(properties).map(tp).join(' ')}>\n`;
}


function sendSeaviewManifest (req, res) {
    const manifest = {
        name: req.seaviewConfig.compendiumTitle,
        start_url: 'index.html',
        display: 'standalone',
        orientation: req.seaviewConfig.orientation || 'portrait',
        icons: [
            { src: 'images/icons-192.png', type: 'image/png', sizes: '192x192' },
            { src: 'images/icons-512.png', type: 'image/png', sizes: '512x512' }
        ]
    };
    res.status(200).json(manifest);
}

function sendSeaviewIndex (req, res) {
    let head = `<title>${req.seaviewConfig.compendiumTitle}</title>\n`
    + genMetaTag ({
        name: 'viewport',
        content: 'width=device-width, initial-scale=1'
    })
    + genMetaTag ({
        name: 'manifest',
        content: 'manifest.json'
    })
    + genMetaTag ({
        name: 'Description',
        content: `A compendium of Next-Generation Clustered Heatmaps for ${req.seaviewConfig.compendiumTitle}`
    })
/* Don't try to detect dynamic loading support.
    + genScriptTag ({
        type: 'module',
        crossorigin: undefined
    },
        `window.esDynamicLoading = true; import('${seaviewThemeBase}/${req.seaviewConfig.theme}/theme.js');`
    )
*/
    + genScriptTag ({
        type: 'module',
        src: `${seaviewThemeBase}/${req.seaviewConfig.theme}/theme.js`,
        crossorigin: undefined
    })
    + genScriptTag ({
        nomodule: undefined,
        crossorigin: undefined,
        src: `${seaviewThemeBase}/require.js`
    })
    + genScriptTag ({
        nomodule: undefined,
        crossorigin: undefined,
        src: 'nomodule.js'
    });
    if (process.env.GOOGLE_ANALYTICS_TAGS) {
        let gtags = process.env.GOOGLE_ANALYTICS_TAGS.split(',');
        head = head + genScriptTag({ async: undefined, src: `https:\/\/www.googletagmanager.com/gtag/js?id=${gtags[0]}` });
        head = head + genScriptTag({}, `window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
${gtags.map(gt => "gtag('config', '" + gt + "');")}
`);
    }
    res.status(200);
    res.setHeader('Content-type', 'text/html');
    const lang = req.seaviewConfig.language || "en";
    res.send('<!DOCTYPE html>\n<html lang="' + lang + '">\n<head>\n' + head + '</head>\n<body></body>\n</html>\n');
}


function sendSeaviewNoModuleJS (req, res) {
    const script = `requirejs.config({
    config: {
        seaview: {
            baseURL: '${seaviewThemeBase}',
            theme: '${req.seaviewConfig.theme}'
        }
    },
    paths: {
        seaview: '${seaviewThemeBase}/seaview-nomodule',
        theme: '${seaviewThemeBase}/${req.seaviewConfig.theme}'
    }});
require(['theme/nomodule']);`;

    res.status(200);
    res.setHeader('Content-type', 'application/javascript');
    res.send(script);
};

function sendSeaviewConfig (req, res) {
    var config = { compendiumID: req.params.objid };
    if (req.seaviewAuthorized) {
        /* Create a shallow copy and remove sensitive fields:  mapsCollection, authorizedUsers. */
	config = Object.assign(config, req.seaviewConfig);
	delete config.authorizedUsers;
	delete config.mapsCollection;
	if (!config.viewerURL) config.viewerURL = viewerURL;
    } else {
        /* Provide a minimal config to enable unauthorized users to authenticate. */
        config.authenticators = req.seaviewConfig.authenticators;
        config.compendiumTitle = req.seaviewConfig.compendiumTitle;
    }
    res.status(200);
    res.json({data: config, req: {
        baseUrl : req.baseUrl,
        hostname: req.hostname,
        ip : req.ip,
        ips: req.ips,
        originalUrl: req.originalUrl,
        params: req.params,
        path: req.path,
        protocol: req.protocol,
        query: req.query,
        route: req.route,
        subdomains: req.subdomains,
        userAgent: req.headers['user-agent'],
        xhr: req.xhr
    }});
};

function sendSeaviewNGCHMs (req, res) {
    res.status(200);
    res.json({data: req.seaviewCollection});
};

/* seaviews are actually the read-only faces of compendiums.
 */
const seaviewTypeName = 'compendium';

function defineSeaviewParams (app) {
    app.param ('seaviewId', function (req, res, next, seaviewId) {
      //console.log ('param(objid) objid=' + id);
      if (seaviewId === '..' || seaviewId === '.') {
	res.status(400).send('bad request');
	return;
      }
      req.typeName = seaviewTypeName;
      req.objectPath = storage.getTypeAccessor(seaviewTypeName);
      req.params.objid = seaviewId;
      mapPublicId (req, res, seaviewId, function() {
	  req.objectValid = undefined;
	  next();
      });
    });
}

function setDefaultSeaviewId (req, res, next) {
    req.typeName = seaviewTypeName;
    req.objectPath = storage.getTypeAccessor(seaviewTypeName);
    req.params.objid = '';
    mapPublicId (req, res, '', function() {
        req.objectValid = undefined;
        next();
    });
};

function sendSeaviewFile(req, res) {
    storage.sendFile (res, req.objectPath.file(req.params.filename), function (err) {
        if (err) {
            if (debug) console.log( 'sendFile error in seaview==' + req.params.objid + ", filename==" + req.params.filename );
            if (debug) console.error( err );
            res.status(404).send('error sending file');
        }
    });
}

exports.defineSeaviewRoutes = function (app) {

    console.log ('Defining seaview routes');

    defineSeaviewParams (app);

    /* Note: ORDER matters. */
    app.get (['/', '/index.html', '/seaview'], function(req,res) {
	res.set ('location', '/seaview/index.html');
	res.status(301).send();
    });
    {   /* Send ngchms in view */
	const op = [ loadSeaviewConfig, checkSeaviewAuthorization, failIfNotAuthorized, loadSeaviewCollection, sendSeaviewNGCHMs ];
	app.get ('/seaview/seaview-ngchms.json', setDefaultSeaviewId, op);
	app.get ('/seaview/:seaviewId/seaview-ngchms.json', op);
    }
    {   /* Send view config. */
	const op = [ loadSeaviewConfig, checkSeaviewAuthorization, sendSeaviewConfig ];
	app.get ('/seaview/seaview-config.json', setDefaultSeaviewId, op);
	app.get ('/seaview/:seaviewId/seaview-config.json', op);
    }
    {   /* Send static file from view. */
	const op = [ loadSeaviewConfig, checkSeaviewAuthorization, failIfNotAuthorized, sendSeaviewFile ];
	app.get ('/seaview/file/:filename', setDefaultSeaviewId, op);
	app.get ('/seaview/:seaviewId/file/:filename', op);
    }
    const seaviewCors = {
	origin: "https://cdnjs.cloudflare.com"
    };
    {   /* Send view index.html */
	const op = [ loadSeaviewConfig, cors(seaviewCors), sendSeaviewIndex ];
	app.get ('/seaview/index.html', setDefaultSeaviewId, op);
	app.get ('/seaview/:seaviewId/index.html', op);
	app.get ('/seaview/:seaviewId/', function(req,res) {
	    res.set ('location', '/seaview/' + req.params.objid + '/index.html');
	    res.status(301).send();
	});
    }
    {   /* Send view index.html */
	const op = [ loadSeaviewConfig, cors(seaviewCors), sendSeaviewManifest ];
	app.get ('/seaview/manifest.json', setDefaultSeaviewId, op);
	app.get ('/seaview/:seaviewId/manifest.json', op);
    }
    {   /* Send nomodule.js */
	const op = [ loadSeaviewConfig, cors(seaviewCors), sendSeaviewNoModuleJS ];
	//app.get ('/seaview/nomodule.js', setDefaultSeaviewId, op);
	app.get ('/seaview/:seaviewId/nomodule.js', op);
    }
    {
	app.get ('/api/GetMapByName/:seaviewId/:filename',
		loadSeaviewConfig,
		checkSeaviewAuthorization,
		loadSeaviewCollection,
		function (req, res) {
			const config = Object.assign({}, req.seaviewCollection);
			const collections = Object.entries(req.seaviewCollection);
			// Look in each collection.
			for (let idx = 0; idx < collections.length; idx++) {
				const collection = collections[idx][1];
				// Look at each entry in the collection.
				for (let entidx = 0; entidx < collection.length; entidx++) {
					if (collection[entidx].name === req.params.filename) {
						// Return entry if its name equals what we're seaching for.
						res.status(200);
						res.json({data: collection[entidx] });
						return;
					}
				}
			}
			res.status(404).send();
		}
	);
    }
    console.log ('Defined seaview routes');
};
