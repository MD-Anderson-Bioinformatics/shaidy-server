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

/* Authentication module for 'ldapjwt'.
 *
 * An ldapjwt authentication specification must include the following:
 *
 *  {
 *      href: 'YOUR-LDAPJWT-SERVER-URL/',
 *      clientID: 'YOUR-CLIENT-ID',
 *  }
 *
 *  Notes:
 *  - Replace YOUR-LDAP-SERVER-URL and YOUR-CLIENT-ID by your values.
 */

const debug = false;

const axios = require('axios');

/* Return true iff the given authenticator specification meets our
 * requirements.
 */
exports.isValidAuthenticator = function (config) {

    /* Verify that field f is included in config and is a non-empty string. */
    function badField(f) {
        return !config.hasOwnProperty(f) || typeof config[f] !== 'string' || config[f].length === 0;
    }

    if (!config) {
        console.log ('Ldapjwt specification is missing.');
        return false;
    }

    /* Config must contain valid strings for each of the following. */
    const requiredFields = ['href', 'clientID'];
    const missingFields = requiredFields.filter(badField);
    if (missingFields.length > 0) {
        console.log ('Ldapjwt configuration missing required field(s): ' + missingFields.join(' '));
        console.log (config);
        return false;
    }

    if (config.href.substr(config.href.length-1) !== '/') {
        console.log ('Ldapjwt href must end in a /');
        console.log (config);
        return false;
    }

    if (debug) console.log('Ldapjwt configuration is valid');
    return true;
};

/* Given the authenticator config and an accessToken return a promise for
 * the user's profile.
 */
exports.getProfile = function (conf, accessToken) {
    if (debug) {
        console.log ('Ldapjwt: attempting to validate accessToken: ' + accessToken);
    }
    if (!conf || !conf.href || !conf.clientID) {
        console.log ('Ldapjwt: bad authenticator specification:');
        console.log (conf);
        return Promise.reject(new Error('Ldapjwt: bad authenticator specification'));
    }
    return axios.post (conf.href + 'verify', { token: accessToken })
    .then (userInfo => {
	if (!userInfo) {
            throw new Error('Failed to get ldapjwt user profile for ' + token);
        }
        if (userInfo.data.aud !== conf.clientID) {
            if (debug) {
                console.log ('userInfo.data.aud !== conf.clientID');
                console.log ('userInfo.data:');
                console.log (userInfo.data);
                console.log ('conf:');
                console.log (conf);
            }
            throw new Error('Ldapjwt user profile clientID ' + userInfo.data.aud +
                            ' does not match the required clientID ' + conf.clientID);
        }
        if (!userInfo.data.name) userInfo.data.name = userInfo.data.full_name;
        if (debug) console.log ('Ldapjwt.getProfile returning:');
        if (debug) console.log (userInfo.data);
        return userInfo.data;
    });
};

/* Ldapjwt returns the expiry date as profile.exp.
 */
exports.isStillValid = function (spec, profile) {
    return profile.exp && Date.now() < profile.exp ? profile : null;
};
