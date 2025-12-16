# Shaidy Server

Shaidy Server provides an HTTP API for creating, managing, and viewing Next-Generation Clustered Heat Maps (NG-CHMs).

## Quick Start Instructions

### Authentication Configuration

Authentication is configured by a required JSON-formatted `.authenticators` file that
is mounted to the container at run time. A default version is provided in this repo.

There are two environment variables related to this file (default values in docker-compose.yml):

1. SHAIDY\_AUTHENTICATORS\_HOST: the path of the file on the host machine
2. SHAIDY\_AUTHENTICATORS: the path of the file inside the container

Example format for **no authentication** (where every user is 'Guest User'):    
(note the ':' as part of the key).

```json
{
  "default:": "none"
}
```

Example format for **[LDAP-JWT](https://github.com/MD-Anderson-Bioinformatics/ldap-jwt) authentication**    
(note the ':' as part of the "default:" key).

```json
{
  "ldapjwt": {
    "name": "ldapjwt",
    "type": "ldapjwt",
    "spec": {
      "href": "https://<host name of LDAP-JWT server>/ldap-jwt/",
      "clientID":"<client ID of LDAP-JWT server>"
    }
  },
  "default:":"ldapjwt"
}
```
### Build Images and Start Containers

```bash
docker-compose build
docker-compose up
```

Shaidy server should be up and running.

## Example Usage

These instructions use the [NGCHM R package](https://cran.r-project.org/web/packages/NGCHM/index.html)
to create an NG-CHM, send it to the shaidy server, and view it in the browser.

### 1. Create an NG-CHM

```r
library('NGCHM')
nrow <- 30; ncol <- 30
matrix_data <- matrix(rnorm(nrow * ncol), nrow = nrow, ncol = ncol)
rownames(matrix_data) <- paste("row_", 1:nrow)
colnames(matrix_data) <- paste("col_", 1:ncol)
hm <- chmNew("Testing Shaidy Server", matrix_data)
```

### 2. Configurations for Shaidy Server

The following commands configure usage of the shaidy server, create a collection, and
set the current collection to the newly created one.

```r
chmCreateServer("shaidy-demo", serverSpec = "http://localhost:8188")
## For LDAP-JWT authentication, place the JWT in file "token.txt", then:
##    token <- readLines("token.txt")
##    chmSetCredentials("shaidy-demo", paste0("Bearer ldapjwt:", token))
## For no authentication, this command will ask for a token. Enter any string:
chmCreateCollection("//shaidy-demo/my-collection/")
chmSetCollection("my-collection")
```

### 3. Send the NG-CHM to the Shaidy Server

```r
chmInstall(hm)
```

### 4. View NG-CHM in browser

To view the NG-CHM in the browser, obtain the appropriate hash[^1] and formulate the URL. The steps for that
are:

1. Get the hash of the *collection*

   ```r
   collectionHASH <- chmCurrentCollection()
   ```

2. Get the hash of the *maps* in the collection

   Get the hash of the maps in the collection using both the collection's hash (from step 1)
   and name (in this example: 'my-collection') in a GET request to the search API.

   ```r
   library(httr)
   res <- GET(paste0("http://localhost:8188/api/search/collection/", collectionHASH, "/my-collection"))
   data <- content(res, as = "parsed")
   ngchmHASH <- data$data[[1]]$id
   urlForNGCHM = paste0("http://localhost:8188/NGCHM/chm.html?map=", ngchmHASH)
   print(urlForNGCHM)
   ```

3. Form the URL of the map and view in a browser

   View the NG-CHM by visiting the URL printed in the code block directly above.

## Authors and Acknowledgment

Authors:

- Bradley M. Broom
- Chris Wakefield
- Jun Ma


[^1]: Shaidy server uses directory/file names corresponding to an item's hash, i.e.
Secure Hash Algorithm (SHA) Identifier (ID). Hence the name 'shaidy' server.
