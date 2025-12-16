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
const base64url = require('base64url');
const secureRandom = require('secure-random');

var clientid = secureRandom(64, {type: 'Buffer'});
var secretKey = secureRandom(128, {type: 'Buffer'});

console.log( 'CLIENT_ID=' + base64url( clientid ) );
console.log( 'CLIENT_SECRET=' + base64url( secretKey ) );


