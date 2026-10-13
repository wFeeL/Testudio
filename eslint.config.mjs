import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out/'] },
  ...tseslint.configs.recommended
);
