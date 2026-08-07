import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// storage MUSS gesetzt werden: Supabase greift sonst auf localStorage zu, das
// es in React Native nicht gibt -- der Client faellt dann auf reinen
// Arbeitsspeicher zurueck und die Sitzung ueberlebt keinen App-Neustart.
// Ohne das muesste sich jede Nutzerin bei jedem Oeffnen neu anmelden.
//
// detectSessionInUrl ist ein reines Browser-Feature (Magic-Link-Rueckkehr
// ueber die Adresszeile) und in einer App immer falsch.
export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// Das Token laeuft nach einer Stunde ab. Der Auto-Refresh soll nur laufen,
// solange die App im Vordergrund ist -- im Hintergrund waeren es nutzlose
// Netzaufrufe, und beim Zurueckkommen wird ohnehin sofort erneuert.
AppState.addEventListener('change', state => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
