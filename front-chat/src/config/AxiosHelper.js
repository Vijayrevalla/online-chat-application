import axios from "axios";
export const baseURL = (import.meta.env.VITE_BACKEND_URL || "http://localhost:8083").replace(/\/+$/, "");
export const httpClient = axios.create({
  baseURL: baseURL,
});
