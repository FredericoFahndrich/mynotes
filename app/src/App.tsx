
import { useEffect, useState } from "react";
import "./App.css";

type Note = {
  id: string;
  title: string;
  content: string;
};

const initialNotes: Note[] = [
  {
    id: "planejamento",
    title: "Planejamento da semana",
    content:
      "Nesta semana, quero manter o foco nas minhas prioridades e equilibrar trabalho, saúde e vida pessoal.\n\nAqui estão as principais tarefas e lembretes:",
  },
  {
    id: "ideias",
    title: "Ideias para projetos",
    content: "Registre aqui suas ideias e novos projetos.",
  },
  {
    id: "livros",
    title: "Livros para ler",
    content: "Minha lista de livros e leituras.",
  },
];

const notebooks = [
  "Pessoal",
  "Trabalho",
  "Estudos",
  "Finanças",
  "Viagens",
  "Projetos",
  "Arquivo",
  "Lixeira",
];

const sections = [
  "Geral",
  "Metas",
  "Ideias",
  "Saúde e Bem-estar",
  "Leituras",
  "Cursos",
  "Listas",
  "Diário",
];

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("mynotes-theme") === "dark"
      ? "dark"
      : "light"
  );

  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [activeNoteId, setActiveNoteId] = useState("planejamento");
  const [activeNotebook, setActiveNotebook] = useState("Pessoal");
  const [activeSection, setActiveSection] = useState("Geral");
  const [search, setSearch] = useState("");

  useEffect(() => {
    localStorage.setItem("mynotes-theme", theme);
  }, [theme]);

  const activeNote = notes.find(
    (note) => note.id === activeNoteId
  );

  function updateNote(field: "title" | "content", value: string) {
    setNotes((previous) =>
      previous.map((note) =>
        note.id === activeNoteId
          ? { ...note, [field]: value }
          : note
      )
    );
  }

  function createNote() {
    const id = crypto.randomUUID();

    setNotes((previous) => [
      { id, title: "Nova anotação", content: "" },
      ...previous,
    ]);

    setActiveNoteId(id);
  }

  const visibleNotes = notes.filter((note) =>
    note.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="notes-app" data-theme={theme}>
      <div className="app-window">

        <header className="app-header">
          <div className="app-brand">
            <span className="app-logo">▣</span>
            <strong>Minhas Anotações</strong>
          </div>

          <input
            className="search-input"
            placeholder="Buscar em todas as anotações..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <div className="header-actions">
            <button
              className="theme-button"
              onClick={() =>
                setTheme(theme === "light" ? "dark" : "light")
              }
              title="Alternar modo claro e escuro"
            >
              {theme === "light" ? "☾" : "☀"}
            </button>

            <span className="account-status">
              Prévia local
            </span>

            <span className="avatar">U</span>
          </div>
        </header>

        <main className="workspace">
          <aside className="panel notebooks-panel">
            <h3>Cadernos</h3>

            {notebooks.map((notebook) => (
              <button
                key={notebook}
                className={
                  activeNotebook === notebook
                    ? "nav-item selected"
                    : "nav-item"
                }
                onClick={() => setActiveNotebook(notebook)}
              >
                <span className="nav-dot" />
                {notebook}
              </button>
            ))}
          </aside>

          <aside className="panel sections-panel">
            <h3>Seções</h3>

            {sections.map((section) => (
              <button
                key={section}
                className={
                  activeSection === section
                    ? "nav-item selected"
                    : "nav-item"
                }
                onClick={() => setActiveSection(section)}
              >
                <span className="section-indicator" />
                {section}
              </button>
            ))}
          </aside>

          <aside className="panel pages-panel">
            <div className="panel-title">
              <h3>Páginas</h3>
              <button onClick={createNote} title="Nova página">
                +
              </button>
            </div>

            {visibleNotes.map((note) => (
              <button
                key={note.id}
                className={
                  activeNoteId === note.id
                    ? "page-item selected"
                    : "page-item"
                }
                onClick={() => setActiveNoteId(note.id)}
              >
                <span className="page-icon">▤</span>
                <span>{note.title}</span>
              </button>
            ))}
          </aside>

          <section className="editor-panel">
            {activeNote && (
              <>
                <div className="editor-toolbar">
                  <span>Texto normal</span>
                  <span> B </span>
                  <span> I </span>
                  <span> U </span>
                  <span> ☷ </span>
                  <span> ☑ </span>
                  <span> ⋯ </span>
                </div>

                <div className="editor-content">
                  <input
                    className="note-title"
                    value={activeNote.title}
                    onChange={(event) =>
                      updateNote("title", event.target.value)
                    }
                  />

                  <div className="note-tags">
                    <span>Planejamento</span>
                    <span>Rotina</span>
                    <span>Pessoal</span>
                  </div>

                  <textarea
                    className="note-body"
                    value={activeNote.content}
                    onChange={(event) =>
                      updateNote("content", event.target.value)
                    }
                  />

                  <div className="tasks-card">
                    <h3>Minhas tarefas</h3>
                    <label><input type="checkbox" /> Estudar 1 hora por dia</label>
                    <label><input type="checkbox" /> Organizar meus projetos</label>
                    <label><input type="checkbox" /> Revisar planejamento</label>
                  </div>

                  <div className="note-card">
                    <h3>Metas da semana</h3>
                    <p>Avançar no projeto principal.</p>
                    <p>Manter uma rotina organizada.</p>
                  </div>
                </div>

                <button className="new-note-button" onClick={createNote}>
                  + Nova anotação
                </button>
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
