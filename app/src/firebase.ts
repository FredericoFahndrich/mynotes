
import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";

// Configuração do projeto Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAQn6YlOwkgHOLXs272-tcwMl1YP_SScwA",
  authDomain: "mynotes-auth-af57d.firebaseapp.com",
  projectId: "mynotes-auth-af57d",
  storageBucket: "mynotes-auth-af57d.firebasestorage.app",
  messagingSenderId: "214313205677",
  appId: "1:214313205677:web:69ae3d0eb37506cb492b24"
};

// Inicialização da aplicação
const app = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

// Serviço de autenticação
export const auth = getAuth(app);

export default app;
