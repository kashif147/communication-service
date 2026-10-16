import { Client } from "@microsoft/microsoft-graph-client";
import "isomorphic-fetch";

// Returns a Graph client using an access token
// (app-only token from services/graphAuth.service.js: the document-storage application)
export function getGraphClient(accessToken) {
  return Client.init({
    authProvider: (done) => done(null, accessToken),
  });
}
