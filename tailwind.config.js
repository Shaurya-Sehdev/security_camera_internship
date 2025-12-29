/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./views/**/*.html",
    "./views/**/*.ejs", // your HTML files
    "./routes/**/*.js", // if classes are inside JS files
    "./public/**/*.html", // if any static HTML files in public
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
