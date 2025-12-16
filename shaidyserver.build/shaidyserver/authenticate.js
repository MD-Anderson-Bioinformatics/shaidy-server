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

/* This module defines a generic interface to validating access tokens based on
 * tables of allowed authenticator specifications.
 *
 * Each table is specified as an object containing the allowed authenticators.
 * Each entry looks like:
 *
 *     key: {
 *         name: string,
 *         type: string,
 *         spec: { ... }
 *     }
 *
 * - name is a user-friendly string that might be displayed in a user interface.
 * - type specifies the authentication scheme to use. See knownAuthenticators below.
 * - spec defines settings specific to the authentication scheme.
 *
 * Bearer tokens should be prefixed with the authenticator's key and a colon, followed
 * by the specific authentication scheme's bearer token.
 *
 * However, if the table contains 'default:' (note the colon in the key) it will
 * be used as the key for bearer tokens that have no key prefix.
 * e.g. "default:": "foobar" will use the foobar authentication scheme if its missing.
 */

const crypto = require('crypto');
const logger = require('./logger');

/* Authentication types we know how to handle.
 */
const knownAuthenticators = {
    auth0: require('./authenticator-auth0'),
    ldapjwt: require('./authenticator-ldapjwt')
};

/* Returns a copy of the given authenticator table with authenticators of
 * unknown types removed.
 */
module.exports.removeUnknownAuthenticatorTypes = removeUnknownAuthenticatorTypes;
function removeUnknownAuthenticatorTypes(data) {
    const known = Object.keys(knownAuthenticators);
    let auth = {};
    for (let k in data) {
        if (k === 'default:') {
            auth[k] = data[k];
        } else if (known.indexOf(data[k].type) < 0) {
            logger.error(`Unknown type of shaidy authenticator: ${data[k].type}`);
            process.exit(1)
        } else if (!knownAuthenticators[data[k].type].isValidAuthenticator(data[k].spec)) {
            logger.error(`Badly specified shaidy authenticator: ${JSON.stringify(data[k], null, 2)}`);
            process.exit(1)
        } else {
            auth[k] = data[k];
        }
    }
    return auth;
}

/* Generate a key from the bearerToken (which includes the
 * authorization scheme) and the authorization configuration.
 */
function getKey(bearerToken, authConf) {
    const hash = crypto.createHash('sha256');
    hash.update(bearerToken);
    hash.update(JSON.stringify(authConf));
    return bearerToken + hash.digest('hex');
}

const key2user = {};

/* If the request includes a valid bearer token, req.user will be set
 * to the user's profile before next is called.
 * Otherwise, req will not be modified before next is called.
 *
 * allowedAuthenticators is an object containing the configuration
 * details of the allowed authenticators.
 */
exports.checkRequestToken = checkRequestToken;

const guestUser = {
        user_name: 'guest_user',
        full_name: 'Guest User',
        name: 'Guest User',
        mail: 'guest_user@example.com'
      }

function checkRequestToken(allowedAuthenticators, req, res, next) {
    if (allowedAuthenticators["default:"] == "none") {
      req.user = guestUser;
      logger.warn('Default authentication is "none". Using guest user.');
      next();
      return;
    }
    if (!req.headers.authorization || req.headers.authorization.search('Bearer ') !== 0) {
      logger.info('Token validator: no bearer token');
      next();
      return;
    }
    const token = req.headers.authorization.substr('Bearer '.length);

    var authenticatorKey;
    var authenticatorToken;

    /* Bearer tokens must be prefixed with the authenticator's key and a colon. */
    const prefixLen = token.indexOf(':');
    if (prefixLen > 0) {
        authenticatorKey = token.substr(0, prefixLen);
        authenticatorToken = token.substr(prefixLen + 1);
    } else if (prefixLen < 0 && allowedAuthenticators.hasOwnProperty('default:')) {
        /* But if config includes a default, we assume it's that type. */
        authenticatorKey = allowedAuthenticators['default:'];
        authenticatorToken = token;
    } else {
        logger.error('Token validator: badly formed token');
        next();
        return;
    }
    if (authenticatorToken.length === 0) {
        logger.error('Token validator: badly formed token');
        next();
        return;
    }
    /* Ensure specified authenticator is valid.
     * Fail if any of the following:
     * - Authenticator key in token isn't known to us.
     * - No authenticators are allowed.
     * - Authenticator key in token isn't in allowed authenticators.
     */
    if (!knownAuthenticators.hasOwnProperty(authenticatorKey) ||
        !allowedAuthenticators ||
        !allowedAuthenticators.hasOwnProperty(authenticatorKey)) {
        logger.error('Token validator: invalid authenticator key');
        next();
        return;
    }
    const auth = knownAuthenticators[authenticatorKey];
    const spec = allowedAuthenticators[authenticatorKey];

    /* Fail if authenticator has been incorrectly configured.
     */
    if (!spec.spec || !auth.isValidAuthenticator(spec.spec)) {
        logger.error(`Token validator: invalid authenticator specification: ${JSON.stringify(spec.spec, null, 2)}`);
        next();
        return;
    }

    function removeProfile(key) {
        delete key2user[key];
    }

    /* Determine if we already know this user. */
    const key = getKey(token, spec.spec);
    if (!key2user.hasOwnProperty(key)) {
        key2user[key] = auth.getProfile(spec.spec, authenticatorToken);
        setTimeout(() => removeProfile(key), 3600 * 1000); // One hour.
    }

    key2user[key]
        .then(u => auth.isStillValid(spec.spec, u))
        .then(u => {
            if (u) {
                req.user = Object.assign({}, u);
                next();
            } else {
                removeProfile(key);
                next();
            }
        })
        .catch(err => {
            logger.error('Token validator: error getting user profile. err: ', err);
            removeProfile(key);
            next();
        });
}
