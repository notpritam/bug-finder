import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold tracking-tight">Bug Finder</h1>
      <p className="text-zinc-400">React + Vite + Tailwind CSS v4</p>
      <button
        type="button"
        onClick={() => setCount((c) => c + 1)}
        className="rounded-lg bg-violet-600 px-4 py-2 font-medium hover:bg-violet-500 transition-colors"
      >
        Count is {count}
      </button>
    </div>
  )
}

export default App
