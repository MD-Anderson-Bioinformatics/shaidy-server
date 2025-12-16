FROM node:23.6.1-bookworm AS modules-base

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

RUN apt-get update && apt-get install -y python3 g++ make fonts-liberation gsfonts

ENV HOME=/usr/local/shaidyserver

WORKDIR ${HOME}

COPY shaidyserver/package.json ${HOME}
RUN npm install && npm install nodemon -g && npm install jsdoc -g && npm install -g eslint eslint-plugin-security


FROM node:23.6.1-bookworm AS prod

RUN mkdir -p /usr/share/man/man1
RUN apt-get update && apt-get install -yq --no-install-recommends git zip default-jre

ENV HOME=/usr/local/shaidyserver
WORKDIR ${HOME}
COPY shaidyserver/package.json ${HOME}

# Create an example repo.
# You probably want to mount an external volume over /repo in production.
RUN mkdir -p /repo
COPY example.repo /repo
RUN mkdir -p /repo/collection/users /repo/file /repo/compendium

# Make default account under which to run the server.
# If an external volume is mounted on /repo, run the container
# as the owner of that repository.
ARG REPO_UID=1001
ARG REPO_USER=repoman
RUN useradd -l -u ${REPO_UID} -r ${REPO_USER} -M -d ${HOME}

COPY shaidyserver ${HOME}

COPY --from=modules-base ${HOME}/node_modules ${HOME}/node_modules

# Repo must be owned by the user we will run as.
RUN chown -R ${REPO_USER} \
              /repo \
              /usr/local/shaidyserver

USER ${REPO_USER}

CMD ["npm", "start"]

FROM prod AS dev

## Install / configure helpful tools for development
USER root
RUN apt-get update && apt-get install -y  jq tree vim && \
    printf 'PS1="\033[1;32m\u@shaidy-server:\w $ \033[0m"\nalias ls="ls --color=auto"\nalias vi=vim\n' >> /etc/skel/.bashrc && \
    printf "syntax on\n:set hlsearch\n:set ruler\n:set ts=2\n:set list\n:set listchars=tab:<>\n" >> /etc/skel/.vimrc && \
    echo '-w "\\n"' >> /etc/skel/.curlrc   && \
    cp /etc/skel/.bashrc ${HOME} && \
    cp /etc/skel/.vimrc  ${HOME} && \
    cp /etc/skel/.curlrc ${HOME}
USER ${REPO_USER}

CMD ["npm", "run", "startDev"]
