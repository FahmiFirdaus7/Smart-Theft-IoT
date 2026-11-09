module.exports = {
  content: ['./index.html', './js/*.js'],
  theme: { extend: {
    colors: { ink: '#16213E', paper: '#F4F6FB', brand: '#2F6BFF', tone: 'rgb(var(--tone) / <alpha-value>)' },
    fontFamily: { display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'], sans: ['Figtree', 'system-ui', 'sans-serif'] }
  } }
};
