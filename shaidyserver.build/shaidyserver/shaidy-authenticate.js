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

/* This module defines an authenticator for the shaidy api.
 */
const fs = require('fs');
const authenticate = require('./authenticate');
const logger = require('./logger');

/* Load the accepted authenticators from the specification file.
 * Authenticators with unknown types or invalid specifications are
 * removed.  In case that leaves none, the impossible authenticator
 * is included to indicate to clients that authentication is
 * required.
 */
function loadShaidyAuthenticators() {
    const iAuth = { impossible: { name: 'Impossible', type: 'impossible', spec: {} } };

    if (!process.env.SHAIDY_AUTHENTICATORS) {
	logger.info('No SHAIDY_AUTHENTICATORS specified.');
        return iAuth;
    } else {
	try {
	    const data = JSON.parse (fs.readFileSync (process.env.SHAIDY_AUTHENTICATORS));
            return Object.assign(authenticate.removeUnknownAuthenticatorTypes(data), iAuth);
	} catch (e) {
	    logger.error('Error reading/parsing SHAIDY_AUTHENTICATORS: ' + e.toString());
	    return iAuth;
	}
    }
}

/* Load the acceptable authenticator specifications.
 */
const shaidyAuthenticators = loadShaidyAuthenticators();

/* This is an express middleware that verifies the req has a
 * valid authorization header.  The user's profile will be
 * inserted at req.user before next is called.
 *
 * It fails the request with a 401 error otherwise.
 */
module.exports.shaidyAuthenticator = function (req, res, next) {
    authenticate.checkRequestToken (shaidyAuthenticators, req, res, () => {
	if (req.user) {
	    next();
	} else {
	    res.status(401).send('authentication required');
	}
    });
}

/* Return the acceptable authenticators.
 */
module.exports.getShaidyAuthenticators = function() {
    const cfg = Object.assign({}, shaidyAuthenticators);
    delete cfg['default:'];
    return cfg;
}
