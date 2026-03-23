import { useNavigate } from "react-router";
import { useState, useEffect } from "react";
import { authenticate, isAuthenticated } from "../auth";

export default function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAuthenticated()) {
      navigate("/");
    }
  }, [navigate]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const password = formData.get("password") as string;

    if (authenticate(password)) {
      navigate("/");
    } else {
      setError("Incorrect password");
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="w-full max-w-sm text-center px-6">
        <h1 className="text-6xl font-bold text-white tracking-tight mb-2">BFO</h1>
        <p className="text-gray-400 text-sm mb-10">Enter password to continue</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            name="password"
            placeholder="Password"
            required
            autoFocus
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 text-center text-lg tracking-widest"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            className="w-full py-3 bg-white text-black font-semibold rounded-xl hover:bg-gray-200 transition-colors cursor-pointer"
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  );
}
