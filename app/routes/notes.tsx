import { data, Form, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/notes";
import { prisma } from "../db.server";

export function meta() {
  return [{ title: "Notes" }];
}

export async function loader() {
  const notes = await prisma.note.findMany({
    orderBy: { createdAt: "desc" },
  });
  return { notes };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const title = formData.get("title");
    const body = formData.get("body");

    if (typeof title !== "string" || typeof body !== "string") {
      return data({ error: "Title and body are required" }, { status: 400 });
    }

    await prisma.note.create({ data: { title, body } });
  }

  if (intent === "delete") {
    const id = formData.get("id");
    if (typeof id !== "string") {
      return data({ error: "ID is required" }, { status: 400 });
    }
    await prisma.note.delete({ where: { id: parseInt(id) } });
  }

  return { ok: true };
}

export default function Notes() {
  const { notes } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 800, margin: "0 auto", padding: "2rem" }}>
      <h1>Notes</h1>

      <Form method="post" style={{ marginBottom: "2rem" }}>
        <input type="hidden" name="intent" value="create" />
        <div style={{ marginBottom: "0.5rem" }}>
          <input
            name="title"
            placeholder="Title"
            required
            style={{ width: "100%", padding: "0.5rem", fontSize: "1rem" }}
          />
        </div>
        <div style={{ marginBottom: "0.5rem" }}>
          <textarea
            name="body"
            placeholder="Write your note..."
            required
            rows={4}
            style={{ width: "100%", padding: "0.5rem", fontSize: "1rem" }}
          />
        </div>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Adding..." : "Add Note"}
        </button>
      </Form>

      {notes.length === 0 ? (
        <p>No notes yet. Add one above!</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {notes.map((note) => (
            <li
              key={note.id}
              style={{
                border: "1px solid #ccc",
                borderRadius: "8px",
                padding: "1rem",
                marginBottom: "1rem",
              }}
            >
              <h2 style={{ margin: "0 0 0.5rem" }}>{note.title}</h2>
              <p style={{ margin: "0 0 0.5rem" }}>{note.body}</p>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <small style={{ color: "#666" }}>
                  {new Date(note.createdAt).toLocaleDateString()}
                </small>
                <Form method="post">
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={note.id} />
                  <button type="submit">Delete</button>
                </Form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
