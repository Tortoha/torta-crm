// The "/" route. Hands off to the Landing composition under Pages/Landing/.
// Kept as a one-line re-export so App.jsx's lazy import path doesn't need to
// change every time the landing's internals get refactored.
export { default } from './Pages/Landing/Landing.jsx';
