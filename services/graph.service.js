import { Client } from "@microsoft/microsoft-graph-client";
import "isomorphic-fetch";

export function getGraphClient(accessToken) {
  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    },
  });
}
