import { auth } from "./firebase";
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, "Entre na sua conta para continuar.");
  const token = await user.getIdToken();
  if (auth.currentUser?.uid !== user.uid) throw new ApiError(401, "A sessão mudou. Entre novamente.");
  const response = await fetch(path, {
    ...options, cache: "no-store", headers: { "Content-Type": "application/json", ...options.headers, Authorization: "Bearer " + token },
  });
  if (auth.currentUser?.uid !== user.uid) throw new ApiError(401, "A sessão mudou. Entre novamente.");
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? "Não foi possível concluir a operação.");
  return data;
}
