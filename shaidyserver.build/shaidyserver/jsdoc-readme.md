Shaidy Server is a node.js server implementation of the
Next-Generation Clustered Heat Map (NG-CHM) Viewer and
NG-CHM Departmental User Interface (DUI) APIs.

Authentication
--------------

Authentication is not required for the read-only NG-CHM viewer API.
Access to a non-user-specific object, such as an NG-CHM,
requires knowing its unique identifier, a long, psuedo-random number.
The API cannot enumerate all object identifiers (except for management
functions), so only those objects that can be reached from a user's
user-specific resources will be accessible.

For the DUI API, authentication is required for all interfaces
that modify the system, as well as all those that access user-specific
resources, such as the user's home, mailbox, clipboard, and trash collections.

Authentication requires a Java Web Token (JWT) encoded specifically
for the running server.  The instance-specific CLIENT_ID and CLIENT_SECRET
parameters (passed in the server's environment) are used to validate JWTs.

This server does not include any mechanism to generate JWTs.
(You can inspect clients such as the NG-CHM DUI for strategies to generate JWTs.
The JWT generator will need to know the values of CLIENT_ID and CLIENT_SECRET
in order to generator acceptable JWTs.)

Authorization
-------------

Authorization to perform management functions is granted by including the
manager's email address in the MANAGER_EMAIL parameter (passed in the server's environment).

This server does not otherwise perform any authorization beyond authentication.

The API does not include any interface that allows one user to modify another
user's user-specific resources, such as their home, mailbox, clipboard, and
trash collections (except for sending a message to their mailbox).

Collections and NG-CHMs can be shared between users.  Once shared, all users
have the same level of access to the object.  All users can modify or delete
objects from any collection to which they have access.  You cannot revoke
another user's access to an object that has been shared with them.

Garbage Collection
------------------

Objects that cannot be accessed from **any** user's user-specific resources
(including the 'public' pseudo-user) are subject to removal.

Removal of inaccessible objects is not automatic; it requires a manager
to initiate a deep clean of the repository.  A generous grace period
is provided for new objects, so that a newly-created NG-CHM is not removed
before it can be added to a collection, for example.
