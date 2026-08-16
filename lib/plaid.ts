import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

/**
 * The Plaid client, configured once for every endpoint that talks to Plaid.
 * Reads PLAID_ENV (defaults to sandbox) and the client id / secret from env.
 */
export function getPlaidClient(): PlaidApi {
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[process.env.PLAID_ENV || "sandbox"],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
          "PLAID-SECRET": process.env.PLAID_SECRET!,
        },
      },
    })
  );
}
