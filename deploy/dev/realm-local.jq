# SPDX-FileCopyrightText: Copyright (c) 2026 OpenShell Dashboard contributors
# SPDX-License-Identifier: Apache-2.0
# What a local run adds to deploy/keycloak/openshell-realm.json, which holds
# no user, no secret and no local address. scripts/dev-env.sh applies it:
#
#   jq --arg client … --arg home … --arg secret … --arg password … \
#      -f deploy/dev/realm-local.jq deploy/keycloak/openshell-realm.json
#
# $client is the dashboard's client and $home the address of the auth proxy.
# It stops when the realm has no such client or lacks a group the users are
# put in: a realm written without them would only fail at sign-in.
#
# The two users have fixed ids, so that the subject a workspace member is
# added by is the same on every machine and after every restart.
def has_group($name): any(.groups[]?; .name == $name);

if any(.clients[]?; .clientId == $client) | not then
  error("the realm has no client \($client)")
elif (has_group("openshell-admins") and has_group("openshell-users")) | not then
  error("the realm has no group openshell-admins or no group openshell-users")
else . end
| .clients |= map(
  if .clientId == $client then
    .redirectUris += [$home + "/oauth2/callback"]
    | .attributes["post.logout.redirect.uris"] += "##" + $home + "/*"
    | .secret = $secret
  else . end)
| .users = [
    {id: "00000000-0000-4000-8000-000000000001", username: "admin1", enabled: true,
     email: "admin1@example.com", emailVerified: true, firstName: "Admin", lastName: "One",
     groups: ["/openshell-admins"],
     credentials: [{type: "password", value: $password, temporary: false}]},
    {id: "00000000-0000-4000-8000-000000000002", username: "user1", enabled: true,
     email: "user1@example.com", emailVerified: true, firstName: "User", lastName: "One",
     groups: ["/openshell-users"],
     credentials: [{type: "password", value: $password, temporary: false}]}
  ]
