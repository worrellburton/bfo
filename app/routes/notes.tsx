import { useEffect, useState } from "react";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Notes" }];
}

interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: number;
}

export default function Notes() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
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
    <div>
      <h1 className="text-3xl font-bold mb-6">Notes</h1>

      <form onSubmit={handleCreate} className="mb-8 space-y-3 max-w-lg">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          required
          className={`w-full px-4 py-2 ${isDark ? "bg-white/5" : "bg-black/5"} border ${isDark ? "border-white/10" : "border-gray-200"} rounded-lg ${isDark ? "text-white" : "text-gray-900"} placeholder-gray-500 focus:outline-none ${isDark ? "focus:border-white/30" : "focus:border-gray-400"}`}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your note..."
          required
          rows={3}
          className={`w-full px-4 py-2 ${isDark ? "bg-white/5" : "bg-black/5"} border ${isDark ? "border-white/10" : "border-gray-200"} rounded-lg ${isDark ? "text-white" : "text-gray-900"} placeholder-gray-500 focus:outline-none ${isDark ? "focus:border-white/30" : "focus:border-gray-400"} resize-none`}
        />
        <button
          type="submit"
          className={`px-5 py-2 ${isDark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-gray-700"} font-medium rounded-lg transition-colors cursor-pointer`}
        >
          Add Note
        </button>
      </form>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : notes.length === 0 ? (
        <p className="text-gray-500">No notes yet.</p>
      ) : (
        <div className="space-y-3 max-w-lg">
          {notes.map((note) => (
            <div key={note.id} className={`p-4 ${isDark ? "bg-white/5" : "bg-black/5"} border ${isDark ? "border-white/10" : "border-gray-200"} rounded-lg`}>
              <div className="flex justify-between items-start">
                <h3 className="font-semibold">{note.title}</h3>
                <button
                  onClick={() => handleDelete(note.id)}
                  className="text-gray-500 hover:text-red-400 text-sm cursor-pointer"
                >
                  Delete
                </button>
              </div>
              {note.body && <p className={`${isDark ? "text-gray-400" : "text-gray-500"} text-sm mt-1`}>{note.body}</p>}
              <small className="text-gray-600 text-xs mt-2 block">
                {new Date(note.createdAt).toLocaleDateString()}
              </small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
