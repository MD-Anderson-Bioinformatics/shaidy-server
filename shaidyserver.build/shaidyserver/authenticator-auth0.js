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

const jwt = require('jsonwebtoken');
const jwks = require('jwks-rsa');

/* Authentication module for 'auth0'.
 *
 * An auth0 authentication specification must look like the following:
 *
 *  {
 *      domain: 'YOURDOMAIN.auth0.com',
 *      clientID: 'YOURCLIENTID',
 *      audience: 'YOURAUDIENCE',
 *      responseType: 'token id_token',
 *      scope: 'openid email profile'
 *  }
 *
 *  Notes:
 *  - Replace YOURDOMAIN, YOURCLIENTID, and YOURAUDIENCE by your values.
 *    YOURAUDIENCE is required so that auth0 returns JWTs that we can decode.
 *  - The given entries in responseType and scope are the minimum
 *    that we require. You can include additional capabilities if you wish.
 *  - When authorizing access, the redirectUri will be set by the client.
 *    It must be listed as a valid redirect URI in your auth0 client definition.
 */


/* Return true iff the given auth0 specification meets our
 * requirements.
 */
exports.isValidAuthenticator = function (config) {

    /* Verify that field f is included in config and is a non-empty string. */
    function badField(f) {
        return !config.hasOwnProperty(f) || typeof config[f] !== 'string' || config[f].length === 0;
    }

    if (!config) {
        console.log ('No auth0 configuration given');
        return false;
    }

    /* Config must contain valid strings for each of the following. */
    const requiredFields = ['domain', 'clientID', 'responseType', 'scope', 'audience'];
    const missingFields = requiredFields.filter(badField);
    if (missingFields.length > 0) {
        console.log ('Auth0 configuration missing required field(s): ' + missingFields.join(' '));
        console.log (config);
        return false;
    }

    let valid = true;

    /* domain must properly end with .auth0.com */
    if (!config.domain.match(/.+\.auth0\.com$/)) {
        console.log ('Auth0 configuration has invalid domain: ' + config.domain);
        valid = false;
    }
    /* responseType must include token and id_token. */
    const rts = config.responseType.split(' ');
    const missingTypes = ['token','id_token'].filter(f => rts.indexOf(f) < 0);
    if (missingTypes.length > 0) {
        console.log ('Auth0 configuration does not include required response types: ' +
                     missingTypes.join(' '));
        valid = false;
    }
    /* scope must include openid, email, and profile. */
    const scps = config.scope.split(' ');
    const missingScopes = ['openid', 'email', 'profile'].filter(s => scps.indexOf(s) < 0);
    if (missingScopes.length > 0) {
        console.log ('Auth0 configuration does not include required scopes: ' +
                     missingScopes.join(' '));
        valid = false;
    }

    if (!valid) {
        console.log('Auth0 configuration that caused the error:');
        console.log(config);
    }
    return valid;
};


/* Returns a function that will get a signing key for
 * the specified auth0 authenticator.
 *
 * The returned function takes two parameters (header, callback).
 * On completion, it calls callback with two parameters (err, key).
 *
 * The returned function can be passed as the second parameter to jwt.verify.
 */
const keyCache = {};
function getKeyFn (auth0spec) {

    function clearKey (keyKey) {
        if (debug) console.log ('Removing ' + keyKey + ' from keyCache');
        delete keyCache[keyKey];
    }

    return function (header, callback) {
        if (debug) console.log ('getKey. header:');
        if (debug) console.log (header);
        const keyKey = `${auth0spec.domain}/${header.kid}`;
        if (!keyCache[keyKey]) {
            // Create and cache a promise for the signing key.
            keyCache[keyKey] = new Promise((resolve) => {
		const jwksUri = `https://${auth0spec.domain}/.well-known/jwks.json`;
		const jwksClient = jwks({
		    cache: true,
		    rateLimit: true,
		    jwksRequestsPerMinute: 5,
		    jwksUri: jwksUri
		});
                jwksClient.getSigningKey (header.kid, function (err, key) {
                    if (debug) console.log ('getSigningKey. got key for ' + keyKey + ':');
                    if (debug) console.log (key);
                    var signingKey = key.publicKey || key.rsaPublicKey;
                    setTimeout(() => clearKey(keyKey), 3600*1000); // One hour.
                    resolve (signingKey);
                });
            });
        }
        // Call callback when the promise resolves.
        keyCache[keyKey]
        .then(signingKey => callback (null, signingKey))
        .catch(err => {
	    console.log ('Error getting signing key:');
            console.log (auth0spec);
	    console.error (err);
            callback (err, null);
        });
    }
}

/* Given the authenticator config and an accessToken, return a promise for
 * the user's profile.
 */
exports.getProfile = function (conf, accessToken) {

    return new Promise((resolve) => {

	if (debug) console.log ('In auth0.getProfile. conf:');
	if (debug) console.log (conf);

	const options = {
	    audience: conf.audience,
	    issuer: `https://${conf.domain}/`,
	    algorithm: 'RS256'
	};

	jwt.verify (accessToken, getKeyFn(conf), options, function (err, decoded) {
	    if (err) {
		if (debug) console.log ('jwt.verify return error:');
		if (debug) console.error (err);
		resolve (null);
	    } else {
		decoded.mail = decoded[conf.audience + 'email'];
		if (debug) console.log ('jwt.verify success:');
		if (debug) console.log (decoded);
		resolve (decoded);
	    }
	});
    })
    .catch(err => {
        console.log ('jwt.verify threw error:');
        console.error (err);
        resolve (null);
    });
};

/* Return profile if it's still valid, otherwise null.
 */
exports.isStillValid = function (spec, profile) {
    // Decoded jwt includes expiry date in seconds as profile.exp
    return profile.exp && Date.now() < profile.exp*1000 ? profile : null;
};
