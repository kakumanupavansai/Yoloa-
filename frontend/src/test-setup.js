import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// Routes are lazy-loaded, so the first visit to a page in a test file also compiles its module on a cold run.
configure({ asyncUtilTimeout: 5000 })
