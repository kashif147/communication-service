import axios from "axios";
import qs from "qs";
import { graphConfig } from "../config/graph.js";

export async function getGraphAccessToken() {
  const url = `${graphConfig.authority}/oauth2/v2.0/token`;

  const body = qs.stringify({
    client_id: graphConfig.clientId,
    client_secret: graphConfig.clientSecret,
    scope: graphConfig.scopes.join(" "),
    grant_type: "client_credentials",
  });

  const response = await axios.post(url, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return response.data.access_token;
}
