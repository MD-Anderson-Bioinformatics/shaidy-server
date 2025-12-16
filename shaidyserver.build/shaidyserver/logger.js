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

const winston = require('winston')

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  defaultMeta: { service: 'user-service' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({format: 'DD-MMM-YYYY HH:mm:ss'}),
        winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`),
      )
    }),
  ],
});

if (process.env.NODE_ENV == 'production') {
  logger.level = 'info';
}

module.exports = logger;
