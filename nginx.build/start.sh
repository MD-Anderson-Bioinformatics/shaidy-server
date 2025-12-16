#!/bin/sh

#  Copyright (C) 2025 The University of Texas MD Anderson Cancer Center
#
#  This file is part of shaidy server.
#
#  shaidy server is free software: you can redistribute it and/or modify it under the terms of the
#  GNU General Public License Version 2 as published by the Free Software Foundation.
#
#  shaidy server is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
#  without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
#  See the GNU General Public License for more details.
#
#  You should have received a copy of the GNU General Public License along with shaidy server.
#  If not, see <https://www.gnu.org/licenses/>.

cp /NGCHM/server.app/chm.html /usr/share/docroot/chm.html
sed -i -e "s:<body:<body data-ngchm-api='/api/':" -e "s:data-ngchm-custom-file='.*':data-ngchm-custom-file='/NGCHM/javascript/custom/custom.js':" /usr/share/docroot/chm.html

exec nginx -g "daemon off;"
