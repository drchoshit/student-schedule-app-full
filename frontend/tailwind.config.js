/** @type {import('tailwindcss').Config} */
export default { darkMode:'class', content:['./index.html','./src/**/*.{js,jsx,ts,tsx}'],
  theme:{ extend:{ colors:{ primary:'#2563EB', success:'#10B981', warning:'#F59E0B', danger:'#EF4444', surface:'#F8FAFC' }, boxShadow:{soft:'0 6px 24px rgba(0,0,0,0.08)'} } }, plugins:[] };