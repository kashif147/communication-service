import { Client } from "@microsoft/microsoft-graph-client";
import "isomorphic-fetch";

const graphConfig = {
  clientId: process.env.GRAPH_CLIENT_ID,
  clientSecret: process.env.GRAPH_CLIENT_SECRET,
  tenantId: process.env.GRAPH_TENANT_ID,
  authority: `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}`,
  scopes: ["https://graph.microsoft.com/.default"],
};

// Returns a Graph client using an access token
export function getGraphClient(accessToken) {
  return Client.init({
    authProvider: (done) => done(null, accessToken),
  });
}

export { graphConfig };
