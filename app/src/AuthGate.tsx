
import { Fragment, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import type { User } from "firebase/auth";
import { auth } from "./firebase";
import "./AuthGate.css";

type Mode = "login" | "register" | "reset";

export default function AuthGate({
  children,
}: {
  children: ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [verified, setVerified] = useState(false);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
    const [theme, setTheme] = useState<"light" | "dark">(
    () =>
        localStorage.getItem("mynotes-theme") === "dark"
        ? "dark"
        : "light"
    );

    function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    localStorage.setItem("mynotes-theme", next);
    setTheme(next);
    }


  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setVerified(Boolean(currentUser?.emailVerified));
      setReady(true);
    });
  }, []);

  async function loginGoogle() {
    setLoading(true);
    setMessage("");

    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Erro de autenticação:", error);
      setMessage("Não foi possível entrar com Google.");
    } finally {
      setLoading(false);
    }
  }

  async function handleEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      if (mode === "reset") {
        await sendPasswordResetEmail(auth, email);
        setMessage(
          "Se existir uma conta com esse e-mail, enviaremos as instruções de recuperação."
        );
      } else if (mode === "register") {
        const result = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );

        await sendEmailVerification(result.user);
        setMessage("Enviamos um link para confirmar seu e-mail.");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      console.error("Erro de autenticação:", error);
      setMessage(
        "Não foi possível concluir a operação. Confira os dados e tente novamente."
      );
    } finally {
      setLoading(false);
    }
  }

  async function checkVerification() {
    if (!auth.currentUser) return;

    setLoading(true);

    try {
      await reload(auth.currentUser);
      await auth.currentUser.getIdToken(true);
      setVerified(auth.currentUser.emailVerified);

      if (!auth.currentUser.emailVerified) {
        setMessage("O e-mail ainda não foi confirmado.");
      }
    } catch {
      setMessage("Não foi possível verificar o e-mail.");
    } finally {
      setLoading(false);
    }
  }

  async function resendVerification() {
    if (!auth.currentUser) return;

    setLoading(true);

    try {
      await sendEmailVerification(auth.currentUser);
      setMessage("Novo e-mail de confirmação enviado.");
    } catch {
      setMessage("Não foi possível reenviar a confirmação.");
    } finally {
      setLoading(false);
    }
  }

  if (!ready) {
    return <div className="auth-loading">Carregando...</div>;
  }

  // Libera a interface somente após autenticação
  // e confirmação do endereço de e-mail.
  if (user && verified) {
    return <Fragment key={user.uid}>{children}</Fragment>;
  }

  if (user && !verified) {
    return (
      <main className="auth-page" data-theme={theme}>
        <div className="auth-card">

            <button
            type="button"
            className="auth-theme-toggle"
            onClick={toggleTheme}
            title={theme === "light" ? "Modo escuro" : "Modo claro"}
            aria-label={
                theme === "light"
                ? "Ativar modo escuro"
                : "Ativar modo claro"
            }
            >
            {theme === "light" ? "☾" : "☀"}
            </button>

          <h1>Confirme seu e-mail</h1>
          <p>
            Acesse sua caixa de entrada e confirme o
            endereço cadastrado antes de continuar.
          </p>

          <button disabled={loading} onClick={checkVerification}>
            Já confirmei meu e-mail
          </button>

          <button disabled={loading} onClick={resendVerification}>
            Reenviar confirmação
          </button>

          <button onClick={() => signOut(auth)}>
            Sair da conta
          </button>

          {message && <p role="status">{message}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page" data-theme={theme}>
      <div className="auth-card">

        <button
        type="button"
        className="auth-theme-toggle"
        onClick={toggleTheme}
        title={theme === "light" ? "Modo escuro" : "Modo claro"}
        aria-label={
            theme === "light"
            ? "Ativar modo escuro"
            : "Ativar modo claro"
        }
        >
        {theme === "light" ? "☾" : "☀"}
        </button>

        <div className="auth-brand">
          <span className="auth-logo">▣</span>
          <h1>Minhas Anotações</h1>
          <p>Seus cadernos, suas ideias, seu espaço.</p>
        </div>

        <button
          type="button"
          className="google-button"
          disabled={loading}
          onClick={loginGoogle}
        >
          Continuar com Google
        </button>

        <div className="auth-divider">
          <span>ou utilize seu e-mail</span>
        </div>

        <h2>
          {mode === "login"
            ? "Entrar"
            : mode === "register"
              ? "Criar conta"
              : "Recuperar senha"}
        </h2>

        <form onSubmit={handleEmail}>
          <label htmlFor="auth-email">E-mail</label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="seuemail@exemplo.com"
          />

          {mode !== "reset" && (
            <>
              <label htmlFor="auth-password">Senha</label>
              <input
                id="auth-password"
                type="password"
                autoComplete={
                  mode === "register"
                    ? "new-password"
                    : "current-password"
                }
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Digite sua senha"
              />
            </>
          )}

          <button
            className="auth-submit"
            type="submit"
            disabled={loading}
          >
            {loading
              ? "Aguarde..."
              : mode === "login"
                ? "Entrar"
                : mode === "register"
                  ? "Criar conta"
                  : "Recuperar senha"}
          </button>
        </form>

        <div className="auth-links">
          {mode === "login" && (
            <>
              <button onClick={() => setMode("reset")}>
                Esqueceu sua senha?
              </button>
              <button onClick={() => setMode("register")}>
                Criar uma conta
              </button>
            </>
          )}

          {mode !== "login" && (
            <button onClick={() => setMode("login")}>
              Voltar para login
            </button>
          )}
        </div>

        {message && (
          <p className="auth-message" role="status">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
