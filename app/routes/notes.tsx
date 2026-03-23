import { redirect } from "react-router";
import type { Route } from "./+types/notes";
import { isAuthenticated } from "../session.server";
import { useEffect, useState } from "react";

export function meta() {
  return [{ title: "BFO - Notes" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  if (!(await isAuthenticated(request))) {
    throw redirect("/login");
  }
  return {};
}

interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: number;
}

export default function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function setup() {
      const { db } = await import("../firebase");
      const { ref, onValue } = await import("firebase/database");

      const notesRef = ref(db, "notes");
      unsubscribe = onValue(notesRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const notesArray = Object.entries(data).map(([id, value]) => ({
            id,
            ...(value as Omit<Note, "id">),
          }));
          notesArray.sort((a, b) => b.createdAt - a.createdAt);
          setNotes(notesArray);
        } else {
          setNotes([]);
        }
        setLoading(false);
      });
    }

    setup();
    return () => unsubscribe?.();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;

    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");

    await push(ref(db, "notes"), {
      title: title.trim(),
      body: body.trim(),
      createdAt: Date.now(),
    });

    setTitle("");
    setBody("");
  }

  async function handleDelete(id: string) {
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, "notes/" + id));
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 800, margin: "0 auto", padding: "2rem" }}>
      <h1>Notes</h1>

      <form onSubmit={handleCreate} style={{ marginBottom: "2rem" }}>
        <div style={{ marginBottom: "0.5rem" }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            required
            style={{ width: "100%", padding: "0.5rem", fontSize: "1rem" }}
          />
        </div>
        <div style={{ marginBottom: "0.5rem" }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your note..."
            required
            rows={4}
            style={{ width: "100%", padding: "0.5rem", fontSize: "1rem" }}
          />
        </div>
        <button type="submit">Add Note</button>
      </form>

      {loading ? (
        <p>Loading...</p>
      ) : notes.length === 0 ? (
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
                <button onClick={() => handleDelete(note.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
