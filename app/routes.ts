import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("login", "routes/login.tsx"),
  layout("routes/app-layout.tsx", [
    index("routes/home.tsx"),
    route("frameworks", "routes/frameworks.tsx"),
    route("notes", "routes/notes.tsx"),
  ]),
] satisfies RouteConfig;
