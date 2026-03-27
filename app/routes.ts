import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("login", "routes/login.tsx"),
  layout("routes/app-layout.tsx", [
    index("routes/home.tsx"),
    route("frameworks", "routes/frameworks.tsx"),
    route("assets", "routes/assets.tsx"),
    route("assets/:id", "routes/asset-detail.tsx"),
    route("notes", "routes/notes.tsx"),
    route("agents", "routes/agents.tsx"),
    route("agents/:id", "routes/agent-chat.tsx"),
    route("office", "routes/office.tsx"),
    route("calculations", "routes/calculations.tsx"),
    route("calculations/developer-payment", "routes/calc-dev-payment.tsx"),
  ]),
] satisfies RouteConfig;
