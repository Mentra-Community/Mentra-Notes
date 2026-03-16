/**
 * PostHog client initialization
 */

import PostHog from "posthog-js";

PostHog.init("phc_QuuFFRBKtdPDMsA96Yw608iwmcOe5UtZcHOzpTbSF0y", {
  api_host: "/api/posthog",
  ui_host: "https://us.posthog.com",
  persistence: "memory",
});

export default PostHog;
