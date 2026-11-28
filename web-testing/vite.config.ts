import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// base './' saat build supaya asset bersifat RELATIF — dashboard ini bisa
// disajikan dari root (server standalone :3001) maupun dari route tersembunyi
// di web utama (mis. /_testing/ di :8000) tanpa mengubah build.
// Mode dev tetap memakai '/' agar tidak mengganggu Vite dev server.
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  base: command === 'build' ? './' : '/',
}))
