import { HashRouter, Routes, Route } from 'react-router-dom'
import { LocaleProvider } from './hooks/useLocale.jsx'
import Home from './pages/Home.jsx'
import RecipeView from './pages/RecipeView.jsx'
import Editor from './pages/Editor.jsx'
import Fridge from './pages/Fridge.jsx'
import Deals from './pages/Deals.jsx'
import ChatDrawer from './components/ChatDrawer.jsx'

export default function App() {
  return (
    <LocaleProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/recipe/:slug" element={<RecipeView />} />
          <Route path="/deals" element={<Deals />} />
          {import.meta.env.DEV && <Route path="/editor" element={<Editor />} />}
          {import.meta.env.DEV && <Route path="/fridge" element={<Fridge />} />}
        </Routes>
        {import.meta.env.DEV && <ChatDrawer />}
      </HashRouter>
    </LocaleProvider>
  )
}
