package com.chris.unbacd.web;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {

    private static final long   UI_TICK_MS        = 10_000L;      // 10 s  — keeps "Updated X ago" live
    private static final long   POLL_INTERVAL_MS  = 60_000L;      // 1 min — web API poll (server still rate-limits Untappd sync)
    private static final long   STALE_AFTER_MS    = 15 * 60_000L;
    private static final String PREFS_NAME        = "unbacd-web";
    private static final String PREF_DEVICE_TOKEN = "device-token";
    private static final String WEB_API_BASE      = "https://unbacd-web.vercel.app";

    // BAC thresholds
    private static final double BAC_DO_NOT_DRIVE = 0.05;
    private static final double BAC_CAUTION      = 0.12;
    private static final double BAC_DANGER       = 0.20;

    // Colors
    private static final int BG_DEFAULT     = 0xff080604;
    private static final int BG_ORANGE_LT   = 0xfffb923c;
    private static final int BG_ORANGE      = 0xfff97316;
    private static final int BG_RED_LT      = 0xffef4444;
    private static final int BG_RED         = 0xffdc2626;
    private static final int BG_DANGER_BLUE = 0xff1e40af;
    private static final int COLOR_SOBER    = 0xff9ca3af;
    private static final int COLOR_ACCENT   = 0xffffd166;

    private final Handler         handler  = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    // State
    private double  currentBac       = -1.0;
    private long    generatedAt      = 0L;
    private long    timeUntilSoberMs = 0L;
    private int     drinkCount       = 0;
    private String  userName         = "";
    private long    updatedAt        = 0L;
    private boolean syncRequestSent  = false;
    private boolean pollInFlight     = false;
    private boolean pairingInFlight  = false;
    private String  deviceToken      = null;
    private final List<WatchBeerItem> beerListItems = new ArrayList<>();
    private int selectedBeerIndex = -1;

    private static class WatchBeerItem {
        int checkinId;
        String beerName;
        String breweryName;
        double abv;
        String servingType;
        Integer volumeMlOverride;
        long createdAtMs;
        boolean phantom;
    }

    // Flash state for danger zone (BAC >= 0.20)
    private boolean isFlashing = false;
    private boolean flashPhase = false;
    private final Handler flashHandler = new Handler(Looper.getMainLooper());
    private final Runnable flashRunnable = new Runnable() {
        @Override public void run() {
            if (!isFlashing) return;
            rootLayout.setBackgroundColor(flashPhase ? BG_DANGER_BLUE : BG_RED);
            flashPhase = !flashPhase;
            flashHandler.postDelayed(this, 500);
        }
    };

    // Views
    private FrameLayout rootLayout;
    private TextView titleText;
    private TextView bacNumberText;
    private TextView bacLabelText;
    private TextView soberTimeText;
    private TextView drinkCountText;
    private TextView handleText;
    private TextView updatedText;
    private TextView staleText;
    private TextView doNotDriveText;
    private TextView doNotWalkText;
    private FrameLayout beerListOverlay;
    private FrameLayout pairingOverlay;
    private FrameLayout splashOverlay;
    private EditText pinEditText;
    private Button connectBtn;
    private ListView beerListView;
    private TextView beerSelectedLabel;

    private final Runnable uiTicker = new Runnable() {
        @Override public void run() {
            refreshTickedViews();
            handler.postDelayed(this, UI_TICK_MS);
        }
    };

    private final Runnable pollTicker = new Runnable() {
        @Override public void run() {
            pollWebApi();
            handler.postDelayed(this, POLL_INTERVAL_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        deviceToken = prefs.getString(PREF_DEVICE_TOKEN, null);

        buildUi();

        showSplash();
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.post(uiTicker);
        handler.post(pollTicker);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(uiTicker);
        handler.removeCallbacks(pollTicker);
        isFlashing = false;
        flashHandler.removeCallbacks(flashRunnable);
        super.onPause();
    }

    // ── Polling ──────────────────────────────────────────────────────────────

    private void pollWebApi() {
        if (deviceToken == null || pollInFlight) return;
        pollInFlight = true;
        executor.execute(() -> {
            try {
                URL url = new URL(WEB_API_BASE + "/api/bac?device=" + deviceToken);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(10_000);
                conn.setReadTimeout(10_000);
                int code = conn.getResponseCode();

                if (code == 404) {
                    // Device token no longer valid — force re-pair
                    handler.post(() -> {
                        deviceToken = null;
                        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                                .remove(PREF_DEVICE_TOKEN).apply();
                        showPairingOverlay();
                    });
                    return;
                }

                if (code == 200) {
                    BufferedReader br = new BufferedReader(
                            new InputStreamReader(conn.getInputStream()));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                    br.close();
                    String json = sb.toString();
                    handler.post(() -> applyWebPayload(json));
                }
            } catch (Exception ignored) {
            } finally {
                pollInFlight = false;
            }
        });
    }

    private void applyWebPayload(String json) {
        try {
            JSONObject obj = new JSONObject(json);
            currentBac       = obj.optDouble("bac", -1.0);
            timeUntilSoberMs = obj.optLong("soberMs", 0L);
            drinkCount       = obj.optInt("drinkCount", 0);
            userName         = obj.optString("username", "");
            generatedAt      = obj.optLong("calculatedAt", System.currentTimeMillis());
            updatedAt        = System.currentTimeMillis();
            syncRequestSent  = false;

            beerListItems.clear();
            JSONArray checkins = obj.optJSONArray("checkins");
            if (checkins != null) {
                for (int i = 0; i < checkins.length(); i++) {
                    JSONObject c = checkins.optJSONObject(i);
                    if (c == null) continue;
                    String beerName = c.optString("beerName", "").trim();
                    if (beerName.isEmpty()) continue;
                    WatchBeerItem item = new WatchBeerItem();
                    item.checkinId = c.optInt("checkinId", -1);
                    item.beerName = beerName;
                    item.breweryName = c.optString("breweryName", "");
                    item.abv = c.optDouble("abv", -1.0);
                    item.servingType = c.optString("servingType", "");
                    item.createdAtMs = c.optLong("createdAtMs", 0L);
                    item.phantom = c.optBoolean("phantom", false);
                    if (c.has("volumeMlOverride") && !c.isNull("volumeMlOverride")) {
                        item.volumeMlOverride = c.optInt("volumeMlOverride");
                    }
                    beerListItems.add(item);
                }
            }

            Collections.sort(beerListItems, new Comparator<WatchBeerItem>() {
                @Override
                public int compare(WatchBeerItem a, WatchBeerItem b) {
                    return Long.compare(b.createdAtMs, a.createdAtMs);
                }
            });

            if (selectedBeerIndex >= beerListItems.size()) selectedBeerIndex = beerListItems.isEmpty() ? -1 : 0;
            if (selectedBeerIndex < 0 && !beerListItems.isEmpty()) selectedBeerIndex = 0;

            refreshAll();
            refreshBeerListUi();
        } catch (Exception ignored) {}
    }

    // ── Pairing ──────────────────────────────────────────────────────────────

    private void showPairingOverlay() {
        hideBeerListOverlay();
        pairingOverlay.setVisibility(View.VISIBLE);
        rootLayout.setBackgroundColor(BG_DEFAULT);
    }

    private void hidePairingOverlay() {
        pairingOverlay.setVisibility(View.GONE);
    }

    private void showSplash() {
        splashOverlay.setVisibility(View.VISIBLE);
        handler.postDelayed(() -> {
            splashOverlay.setVisibility(View.GONE);
            if (deviceToken == null) {
                showPairingOverlay();
            } else {
                refreshAll();
            }
        }, 5000);
    }

    private void submitPin(String rawPin) {
        if (pairingInFlight) return;
        String pin = rawPin.trim().toUpperCase();
        if (pin.length() != 6) {
            Toast.makeText(this, "Enter 6-char PIN", Toast.LENGTH_SHORT).show();
            return;
        }
        pairingInFlight = true;
        connectBtn.setEnabled(false);
        connectBtn.setText("…");
        String deviceId = Settings.Secure.getString(
                getContentResolver(), Settings.Secure.ANDROID_ID);
        executor.execute(() -> {
            try {
                URL url = new URL(WEB_API_BASE + "/api/pair");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("PUT");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(10_000);
                conn.setReadTimeout(10_000);
                String body = "{\"pin\":\"" + pin + "\",\"deviceId\":\"" + deviceId + "\"}";
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.getBytes("UTF-8"));
                }
                int code = conn.getResponseCode();
                if (code == 200) {
                    BufferedReader br = new BufferedReader(
                            new InputStreamReader(conn.getInputStream()));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                    br.close();
                    JSONObject resp = new JSONObject(sb.toString());
                    String token = resp.optString("deviceToken", "");
                    if (!token.isEmpty()) {
                        handler.post(() -> {
                            pairingInFlight = false;
                            deviceToken = token;
                            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                                    .putString(PREF_DEVICE_TOKEN, token).apply();
                            hidePairingOverlay();
                            showNoData();
                            pollWebApi();
                        });
                    } else {
                        handler.post(() -> {
                            pairingInFlight = false;
                            connectBtn.setEnabled(true);
                            connectBtn.setText("Connect");
                            Toast.makeText(this, "Invalid response", Toast.LENGTH_SHORT).show();
                        });
                    }
                } else {
                    handler.post(() -> {
                        pairingInFlight = false;
                        connectBtn.setEnabled(true);
                        connectBtn.setText("Connect");
                        Toast.makeText(this, "Wrong PIN or expired", Toast.LENGTH_SHORT).show();
                    });
                }
            } catch (Exception e) {
                handler.post(() -> {
                    pairingInFlight = false;
                    connectBtn.setEnabled(true);
                    connectBtn.setText("Connect");
                    Toast.makeText(this, "Connection error", Toast.LENGTH_SHORT).show();
                });
            }
        });
    }

    // ── Display ──────────────────────────────────────────────────────────────

    private void showNoData() {
        titleText.setText("un'bac'd");
        bacNumberText.setText("—");
        bacLabelText.setText("WAITING");
        soberTimeText.setText("Waiting for data\u2026");
        drinkCountText.setText("");
        handleText.setText("");
        updatedText.setText("");
        staleText.setVisibility(View.GONE);
        applyTheme(-1.0);
    }

    private void refreshAll() {
        if (currentBac < 0) { showNoData(); return; }
        titleText.setText("un'bac'd");
        bacNumberText.setText(String.format(java.util.Locale.US, "%.2f", currentBac));
        bacLabelText.setText(bacLabel(currentBac));
        applyTheme(currentBac);
        refreshTickedViews();
    }

    private void refreshTickedViews() {
        if (deviceToken == null) return;
        if (currentBac < 0) return; // pollTicker handles fetching

        long nowMs = System.currentTimeMillis();

        // Decay sober time from calculatedAt snapshot
        long elapsedSinceGenMs = nowMs - generatedAt;
        long soberInMs = timeUntilSoberMs - elapsedSinceGenMs;
        if (currentBac < 0.001) {
            soberTimeText.setVisibility(View.GONE);
        } else if (soberInMs <= 0 || currentBac < 0.005) {
            soberTimeText.setVisibility(View.VISIBLE);
            soberTimeText.setText("Sober now");
        } else {
            soberTimeText.setVisibility(View.VISIBLE);
            soberTimeText.setText("Sober in " + formatDuration(soberInMs));
        }

        drinkCountText.setText(drinkCount == 0 ? "No drinks recorded" :
                drinkCount + (drinkCount == 1 ? " drink" : " drinks") + " \u00b7 24h window");

        handleText.setText(userName.isEmpty() ? "" : "@" + userName);

        if (updatedAt > 0) {
            updatedText.setText("Updated " + formatAgo(nowMs - updatedAt));
        }

        boolean isStale = updatedAt > 0 && (nowMs - updatedAt) > STALE_AFTER_MS;
        staleText.setVisibility(isStale ? View.VISIBLE : View.GONE);

        if (isStale && !syncRequestSent) {
            syncRequestSent = true;
            pollWebApi();
        }
        if (!isStale) syncRequestSent = false;
    }

    // ── Beer list modal ─────────────────────────────────────────────────────

    private void showBeerListOverlay() {
        if (beerListOverlay == null) return;
        refreshBeerListUi();
        beerListOverlay.setVisibility(View.VISIBLE);
    }

    private void hideBeerListOverlay() {
        if (beerListOverlay == null) return;
        beerListOverlay.setVisibility(View.GONE);
    }

    private void refreshBeerListUi() {
        if (beerListView == null || beerSelectedLabel == null) return;

        List<String> rows = new ArrayList<>();
        for (WatchBeerItem item : beerListItems) {
            String row = item.beerName + " \u00b7 " + String.format(Locale.US, "%.1f%%", item.abv);
            rows.add(row);
        }

        if (rows.isEmpty()) {
            rows.add("No beers yet");
            selectedBeerIndex = -1;
        } else if (selectedBeerIndex < 0 || selectedBeerIndex >= rows.size()) {
            selectedBeerIndex = 0;
        }

        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_list_item_activated_1, rows);
        beerListView.setAdapter(adapter);
        beerListView.setChoiceMode(ListView.CHOICE_MODE_SINGLE);
        if (selectedBeerIndex >= 0) {
            beerListView.setItemChecked(selectedBeerIndex, true);
        }

        if (selectedBeerIndex >= 0 && selectedBeerIndex < beerListItems.size()) {
            WatchBeerItem s = beerListItems.get(selectedBeerIndex);
            beerSelectedLabel.setText("Selected: " + s.beerName);
        } else {
            beerSelectedLabel.setText("Selected: None");
        }
    }

    private WatchBeerItem selectedBeer() {
        if (selectedBeerIndex < 0 || selectedBeerIndex >= beerListItems.size()) return null;
        return beerListItems.get(selectedBeerIndex);
    }

    private void showBeerDetails() {
        WatchBeerItem item = selectedBeer();
        if (item == null) {
            Toast.makeText(this, "Select a beer first", Toast.LENGTH_SHORT).show();
            return;
        }
        String details = item.beerName
                + "\nABV: " + String.format(Locale.US, "%.1f%%", item.abv)
                + (item.breweryName.isEmpty() ? "" : "\nBrewery: " + item.breweryName)
                + "\nType: " + item.servingType
                + (item.volumeMlOverride == null ? "" : "\nOverride: " + item.volumeMlOverride + " ml")
                + "\nWhen: " + formatAgo(Math.max(0, System.currentTimeMillis() - item.createdAtMs))
                + (item.phantom ? "\nManual beer" : "");
        Toast.makeText(this, details, Toast.LENGTH_LONG).show();
    }

    private void editSelectedBeer() {
        WatchBeerItem item = selectedBeer();
        if (item == null) {
            Toast.makeText(this, "Select a beer first", Toast.LENGTH_SHORT).show();
            return;
        }

        final EditText input = new EditText(this);
        input.setHint("ml (blank = clear)");
        input.setInputType(InputType.TYPE_CLASS_NUMBER);
        if (item.volumeMlOverride != null) {
            input.setText(String.valueOf(item.volumeMlOverride));
            input.setSelection(input.getText().length());
        }

        android.app.AlertDialog dialog = new android.app.AlertDialog.Builder(this)
                .setTitle("Edit serving")
                .setMessage(item.beerName)
                .setView(input)
                .setPositiveButton("Save", null)
                .setNegativeButton("Cancel", null)
                .create();

        dialog.setOnShowListener(d -> dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String txt = input.getText().toString().trim();
            Integer ml = null;
            if (!txt.isEmpty()) {
                try {
                    ml = Integer.parseInt(txt);
                    if (ml < 50 || ml > 2000) {
                        Toast.makeText(this, "Use 50-2000 ml", Toast.LENGTH_SHORT).show();
                        return;
                    }
                } catch (NumberFormatException e) {
                    Toast.makeText(this, "Invalid number", Toast.LENGTH_SHORT).show();
                    return;
                }
            }
            patchServing(item.checkinId, ml);
            dialog.dismiss();
        }));

        dialog.show();
    }

    private void deleteSelectedBeer() {
        WatchBeerItem item = selectedBeer();
        if (item == null) {
            Toast.makeText(this, "Select a beer first", Toast.LENGTH_SHORT).show();
            return;
        }
        new android.app.AlertDialog.Builder(this)
                .setTitle("Delete beer")
                .setMessage("Delete " + item.beerName + "?")
                .setPositiveButton("Delete", (d, w) -> deleteBeer(item.checkinId))
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void patchServing(int checkinId, Integer volumeMl) {
        if (deviceToken == null) return;
        executor.execute(() -> {
            try {
                URL url = new URL(WEB_API_BASE + "/api/checkins/" + checkinId + "?device=" + deviceToken);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("PATCH");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(10_000);
                conn.setReadTimeout(10_000);
                String body = "{\"volumeMl\":" + (volumeMl == null ? "null" : volumeMl) + "}";
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.getBytes("UTF-8"));
                }
                int code = conn.getResponseCode();
                handler.post(() -> {
                    if (code >= 200 && code < 300) {
                        Toast.makeText(this, "Updated", Toast.LENGTH_SHORT).show();
                        pollWebApi();
                    } else {
                        Toast.makeText(this, "Edit failed", Toast.LENGTH_SHORT).show();
                    }
                });
            } catch (Exception e) {
                handler.post(() -> Toast.makeText(this, "Edit error", Toast.LENGTH_SHORT).show());
            }
        });
    }

    private void deleteBeer(int checkinId) {
        if (deviceToken == null) return;
        executor.execute(() -> {
            try {
                URL url = new URL(WEB_API_BASE + "/api/checkins/" + checkinId + "?device=" + deviceToken);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("DELETE");
                conn.setConnectTimeout(10_000);
                conn.setReadTimeout(10_000);
                int code = conn.getResponseCode();
                handler.post(() -> {
                    if (code >= 200 && code < 300) {
                        Toast.makeText(this, "Deleted", Toast.LENGTH_SHORT).show();
                        pollWebApi();
                    } else {
                        Toast.makeText(this, "Delete failed", Toast.LENGTH_SHORT).show();
                    }
                });
            } catch (Exception e) {
                handler.post(() -> Toast.makeText(this, "Delete error", Toast.LENGTH_SHORT).show());
            }
        });
    }

    // ── Theme ─────────────────────────────────────────────────────────────────

    private int bacBgColor(double bac) {
        if (bac < 0.02)          return BG_DEFAULT;
        if (bac < BAC_DO_NOT_DRIVE) return BG_ORANGE_LT;
        if (bac < 0.07)          return BG_ORANGE;
        if (bac < BAC_CAUTION)   return BG_RED_LT;
        return BG_RED;
    }

    private void applyTheme(double bac) {
        boolean danger = bac >= BAC_DANGER;

        if (danger && !isFlashing) {
            isFlashing = true;
            flashPhase = false;
            flashHandler.post(flashRunnable);
        } else if (!danger) {
            isFlashing = false;
            flashHandler.removeCallbacks(flashRunnable);
        }

        doNotDriveText.setVisibility((bac >= BAC_DO_NOT_DRIVE && !danger) ? View.VISIBLE : View.GONE);
        doNotWalkText.setVisibility(danger ? View.VISIBLE : View.GONE);

        int bg = bac < 0 ? BG_DEFAULT : bacBgColor(bac);
        if (!danger) rootLayout.setBackgroundColor(bg);
        boolean dark = (bg == BG_DEFAULT);

        titleText.setTextColor(dark ? COLOR_ACCENT   : 0xffffffff);
        bacNumberText.setTextColor(dark ? 0xfff3f4f6  : 0xffffffff);
        soberTimeText.setTextColor(dark ? 0xfff3f4f6  : 0xffffffff);
        drinkCountText.setTextColor(dark ? 0xff9ca3af  : 0xddffffff);
        handleText.setTextColor(dark ? 0xffaaaaaa      : 0xccffffff);
        updatedText.setTextColor(dark ? 0xffaaaaaa      : 0xccffffff);

        if (dark) {
            bacLabelText.setTextColor(0xff080604);
            setLabelBackground(bacLabelText, COLOR_SOBER);
        } else {
            bacLabelText.setTextColor(0xffffffff);
            setLabelBackground(bacLabelText, 0x33000000);
        }
    }

    private String bacLabel(double bac) {
        if (bac < 0.02)            return "SOBER";
        if (bac < BAC_DO_NOT_DRIVE) return "TRACE";
        if (bac < 0.07)            return "TIPSY";
        if (bac < BAC_CAUTION)     return "CAUTION";
        if (bac < BAC_DANGER)      return "OVER LIMIT";
        return "DANGER";
    }

    private String formatDuration(long ms) {
        long totalMins = ms / 60_000L;
        long h = totalMins / 60;
        long m = totalMins % 60;
        if (h > 0 && m > 0) return h + "h " + m + "m";
        if (h > 0)           return h + "h";
        return m + "m";
    }

    private String formatAgo(long ms) {
        long secs = ms / 1000L;
        if (secs < 60) return secs + "s ago";
        long mins = secs / 60;
        if (mins < 60) return mins + "m ago";
        return (mins / 60) + "h ago";
    }

    // ── UI construction ───────────────────────────────────────────────────────

    private void buildUi() {
        rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(BG_DEFAULT);
        FrameLayout root = rootLayout;

        root.setOnClickListener(v -> {
            if (pairingOverlay != null && pairingOverlay.getVisibility() == View.VISIBLE) return;
            if (splashOverlay != null && splashOverlay.getVisibility() == View.VISIBLE) return;
            if (beerListOverlay != null && beerListOverlay.getVisibility() == View.VISIBLE) {
                hideBeerListOverlay();
            } else {
                showBeerListOverlay();
            }
        });

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        col.setPadding(dp(18), dp(18), dp(18), dp(18));

        // "un'bac'd" title — pinned to top of screen (added to root below)
        titleText = tv("un'bac'd", 13, COLOR_ACCENT, Typeface.BOLD);
        titleText.setGravity(Gravity.CENTER);
        titleText.setLetterSpacing(0.12f);

        // Handle (Untappd username)
        handleText = tv("", 12, 0xff4b5563, Typeface.NORMAL);
        handleText.setGravity(Gravity.CENTER);
        col.addView(handleText, lp(dp(3), 0, 0, 0));

        // Drink count (above BAC number)
        drinkCountText = tv("", 13, 0xff9ca3af, Typeface.NORMAL);
        drinkCountText.setGravity(Gravity.CENTER);
        col.addView(drinkCountText, lp(dp(6), 0, 0, 0));

        // Big BAC number + unit labels row
        LinearLayout bacRow = new LinearLayout(this);
        bacRow.setOrientation(LinearLayout.HORIZONTAL);
        bacRow.setGravity(Gravity.CENTER);

        bacNumberText = tv("\u2014", 54, 0xfff3f4f6, Typeface.BOLD);
        bacNumberText.setIncludeFontPadding(false);
        bacRow.addView(bacNumberText, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));

        LinearLayout unitCol = new LinearLayout(this);
        unitCol.setOrientation(LinearLayout.VERTICAL);
        unitCol.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams unitColLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        unitColLp.leftMargin = dp(5);
        unitColLp.bottomMargin = dp(2);
        TextView bacUnitText = tv("%BAC", 14, 0xfff3f4f6, Typeface.BOLD);
        bacUnitText.setIncludeFontPadding(false);
        TextView bacEstText = tv("(est)", 13, 0xff9ca3af, Typeface.NORMAL);
        bacEstText.setIncludeFontPadding(false);
        unitCol.addView(bacUnitText);
        unitCol.addView(bacEstText);
        bacRow.addView(unitCol, unitColLp);

        LinearLayout.LayoutParams bacRowLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        bacRowLp.topMargin    = 0;
        bacRowLp.bottomMargin = dp(2);
        col.addView(bacRow, bacRowLp);

        // Status badge
        bacLabelText = tv("WAITING", 12, 0xff080604, Typeface.BOLD);
        bacLabelText.setGravity(Gravity.CENTER);
        bacLabelText.setLetterSpacing(0.1f);
        bacLabelText.setPadding(dp(12), dp(4), dp(12), dp(4));
        setLabelBackground(bacLabelText, COLOR_SOBER);
        col.addView(bacLabelText, centredLp(dp(2)));

        // Sober-in time
        soberTimeText = tv("Waiting for data\u2026", 15, 0xfff3f4f6, Typeface.BOLD);
        soberTimeText.setGravity(Gravity.CENTER);
        col.addView(soberTimeText, lp(dp(10), 0, 0, 0));

        root.addView(col, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // Title — pinned to top
        FrameLayout.LayoutParams titleLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        titleLp.topMargin = dp(12);
        root.addView(titleText, titleLp);

        // Updated — pinned to bottom so it stays fixed regardless of content
        updatedText = tv("", 11, 0xff4b5563, Typeface.NORMAL);
        updatedText.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams updatedLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        updatedLp.bottomMargin = dp(14);
        root.addView(updatedText, updatedLp);

        // Stale overlay
        staleText = tv("Data is stale", 13, 0xfffff8e8, Typeface.BOLD);
        staleText.setGravity(Gravity.CENTER);
        staleText.setPadding(dp(14), dp(10), dp(14), dp(10));
        staleText.setBackground(roundRect(0xcc080604, 18));
        staleText.setVisibility(View.GONE);
        FrameLayout.LayoutParams staleLp = new FrameLayout.LayoutParams(
                dp(178), FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        root.addView(staleText, staleLp);

        // DO NOT DRIVE overlay (shown when 0.05 ≤ BAC < 0.20)
        doNotDriveText = tv("DO NOT DRIVE", 16, 0xffffffff, Typeface.BOLD);
        doNotDriveText.setGravity(Gravity.CENTER);
        doNotDriveText.setLetterSpacing(0.10f);
        doNotDriveText.setPadding(dp(18), dp(6), dp(18), dp(6));
        doNotDriveText.setBackground(roundRect(0xdddc2626, 14));
        doNotDriveText.setVisibility(View.GONE);
        FrameLayout.LayoutParams dndLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        dndLp.bottomMargin = dp(28);
        root.addView(doNotDriveText, dndLp);

        // DO NOT WALK overlay (shown when BAC ≥ 0.20, replaces DO NOT DRIVE)
        doNotWalkText = tv("DO NOT WALK", 16, 0xffffffff, Typeface.BOLD);
        doNotWalkText.setGravity(Gravity.CENTER);
        doNotWalkText.setLetterSpacing(0.10f);
        doNotWalkText.setPadding(dp(18), dp(6), dp(18), dp(6));
        doNotWalkText.setBackground(roundRect(0xdd1e40af, 14));
        doNotWalkText.setVisibility(View.GONE);
        FrameLayout.LayoutParams dnwLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        dnwLp.bottomMargin = dp(28);
        root.addView(doNotWalkText, dnwLp);

        // Beer list modal overlay (tap watch to open)
        beerListOverlay = new FrameLayout(this);
        beerListOverlay.setBackgroundColor(0xe6080604);
        beerListOverlay.setVisibility(View.GONE);
        beerListOverlay.setClickable(true);
        beerListOverlay.setOnClickListener(v -> hideBeerListOverlay());

        LinearLayout beerModalCard = new LinearLayout(this);
        beerModalCard.setOrientation(LinearLayout.VERTICAL);
        beerModalCard.setPadding(dp(12), dp(12), dp(12), dp(12));
        beerModalCard.setBackground(roundRect(0xff1a1816, 16));
        beerModalCard.setClickable(true);
        beerModalCard.setOnClickListener(v -> { /* keep overlay open when tapping card */ });

        TextView beerTitle = tv("Recent beers", 14, COLOR_ACCENT, Typeface.BOLD);
        beerTitle.setGravity(Gravity.CENTER_HORIZONTAL);
        beerModalCard.addView(beerTitle, centredLp(0));

        beerSelectedLabel = tv("Selected: None", 10, 0xff9ca3af, Typeface.NORMAL);
        beerSelectedLabel.setGravity(Gravity.CENTER_HORIZONTAL);
        beerModalCard.addView(beerSelectedLabel, centredLp(dp(6)));

        beerListView = new ListView(this);
        beerListView.setDividerHeight(dp(2));
        beerListView.setBackgroundColor(0x00000000);
        LinearLayout.LayoutParams beerListLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            dp(120));
        beerListLp.topMargin = dp(6);
        beerModalCard.addView(beerListView, beerListLp);

        beerListView.setOnItemClickListener((AdapterView<?> parent, View view, int position, long id) -> {
            if (position >= 0 && position < beerListItems.size()) {
            selectedBeerIndex = position;
            refreshBeerListUi();
            }
        });

        LinearLayout actionRow = new LinearLayout(this);
        actionRow.setOrientation(LinearLayout.HORIZONTAL);
        actionRow.setGravity(Gravity.CENTER);
        actionRow.setPadding(0, dp(8), 0, 0);

        Button detailsBtn = new Button(this);
        detailsBtn.setText("Details");
        detailsBtn.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 11);
        detailsBtn.setOnClickListener(v -> showBeerDetails());

        Button editBtn = new Button(this);
        editBtn.setText("Edit");
        editBtn.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 11);
        editBtn.setOnClickListener(v -> editSelectedBeer());

        Button deleteBtn = new Button(this);
        deleteBtn.setText("Delete");
        deleteBtn.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 11);
        deleteBtn.setOnClickListener(v -> deleteSelectedBeer());

        actionRow.addView(detailsBtn);
        actionRow.addView(editBtn);
        actionRow.addView(deleteBtn);
        beerModalCard.addView(actionRow);

        TextView beerHint = tv("Tap outside to close", 10, 0xff9ca3af, Typeface.NORMAL);
        beerHint.setGravity(Gravity.CENTER_HORIZONTAL);
        beerModalCard.addView(beerHint, centredLp(dp(8)));

        FrameLayout.LayoutParams beerModalLp = new FrameLayout.LayoutParams(
            dp(190), FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        beerListOverlay.addView(beerModalCard, beerModalLp);

        root.addView(beerListOverlay, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT));

        // Pairing overlay — shown when no device token stored
        pairingOverlay = new FrameLayout(this);
        pairingOverlay.setBackgroundColor(BG_DEFAULT);
        pairingOverlay.setVisibility(View.GONE);

        LinearLayout pairCol = new LinearLayout(this);
        pairCol.setOrientation(LinearLayout.VERTICAL);
        pairCol.setGravity(Gravity.CENTER);
        pairCol.setPadding(dp(20), dp(20), dp(20), dp(20));

        TextView pairTitle = tv("un'bac'd", 14, COLOR_ACCENT, Typeface.BOLD);
        pairTitle.setGravity(Gravity.CENTER);
        pairTitle.setLetterSpacing(0.12f);
        pairCol.addView(pairTitle, lp(0, dp(8), 0, 0));

        TextView pairInstr = tv("Enter PIN\nfrom web app", 13, 0xff9ca3af, Typeface.NORMAL);
        pairInstr.setGravity(Gravity.CENTER);
        pairCol.addView(pairInstr, lp(0, dp(10), 0, 0));

        pinEditText = new EditText(this);
        pinEditText.setHint("ABC123");
        pinEditText.setHintTextColor(0xff4b5563);
        pinEditText.setTextColor(COLOR_ACCENT);
        pinEditText.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 20);
        pinEditText.setTypeface(Typeface.create(Typeface.MONOSPACE, Typeface.BOLD));
        pinEditText.setGravity(Gravity.CENTER);
        pinEditText.setInputType(InputType.TYPE_CLASS_TEXT
                | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
                | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        pinEditText.setImeOptions(EditorInfo.IME_ACTION_DONE);
        pinEditText.setFilters(new InputFilter[]{ new InputFilter.LengthFilter(6) });
        pinEditText.setBackgroundColor(0xff1a1816);
        pinEditText.setPadding(dp(16), dp(10), dp(16), dp(10));
        LinearLayout.LayoutParams pinLp = new LinearLayout.LayoutParams(dp(130),
                LinearLayout.LayoutParams.WRAP_CONTENT);
        pinLp.gravity = Gravity.CENTER_HORIZONTAL;
        pairCol.addView(pinEditText, pinLp);

        pinEditText.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                submitPin(pinEditText.getText().toString());
                return true;
            }
            return false;
        });

        connectBtn = new Button(this);
        connectBtn.setText("Connect");
        connectBtn.setTextColor(0xff080604);
        connectBtn.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 14);
        connectBtn.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        connectBtn.setBackground(roundRect(COLOR_ACCENT, 999));
        connectBtn.setPadding(dp(24), dp(8), dp(24), dp(8));
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, dp(36));
        btnLp.gravity = Gravity.CENTER_HORIZONTAL;
        btnLp.topMargin = dp(12);
        pairCol.addView(connectBtn, btnLp);

        connectBtn.setOnClickListener(v -> submitPin(pinEditText.getText().toString()));

        pairingOverlay.addView(pairCol, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        root.addView(pairingOverlay, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // Splash overlay — shown on cold launch
        splashOverlay = new FrameLayout(this);
        splashOverlay.setBackgroundColor(BG_DEFAULT);

        LinearLayout splashCol = new LinearLayout(this);
        splashCol.setOrientation(LinearLayout.VERTICAL);
        splashCol.setGravity(Gravity.CENTER);

        android.widget.ImageView splashIcon = new android.widget.ImageView(this);
        splashIcon.setImageResource(R.mipmap.ic_launcher_foreground);
        splashIcon.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams splashIconLp = new LinearLayout.LayoutParams(dp(60), dp(60));
        splashIconLp.gravity = Gravity.CENTER_HORIZONTAL;
        splashIconLp.bottomMargin = dp(8);
        splashCol.addView(splashIcon, splashIconLp);

        TextView splashTitle = tv("un\u2019bac\u2019d", 30, COLOR_ACCENT, Typeface.BOLD);
        splashTitle.setGravity(Gravity.CENTER);
        splashTitle.setLetterSpacing(0.12f);
        splashCol.addView(splashTitle, centredLp(0));

        TextView splashBy = tv("by craftbeers.app", 13, 0xff6b7280, Typeface.NORMAL);
        splashBy.setGravity(Gravity.CENTER);
        splashCol.addView(splashBy, centredLp(dp(5)));

        splashOverlay.addView(splashCol, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // PBU logo — pinned to bottom of splash
        android.widget.ImageView splashLogo = new android.widget.ImageView(this);
        splashLogo.setImageResource(R.drawable.pbu_yellow);
        splashLogo.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        FrameLayout.LayoutParams splashLogoLp = new FrameLayout.LayoutParams(
                dp(100), dp(24), Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        splashLogoLp.bottomMargin = dp(18);
        splashOverlay.addView(splashLogo, splashLogoLp);

        root.addView(splashOverlay, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        setContentView(root);
    }

    // ── UI helpers ────────────────────────────────────────────────────────────

    private void setLabelBackground(TextView v, int color) {
        GradientDrawable gd = new GradientDrawable();
        gd.setShape(GradientDrawable.RECTANGLE);
        gd.setCornerRadius(dp(999));
        gd.setColor(color);
        v.setBackground(gd);
    }

    private TextView tv(String text, int spSize, int color, int style) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, spSize);
        t.setTextColor(color);
        t.setTypeface(Typeface.create(Typeface.DEFAULT, style));
        return t;
    }

    private LinearLayout.LayoutParams lp(int topMargin, int bottomMargin, int l, int r) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        p.setMargins(l, topMargin, r, bottomMargin);
        p.gravity = Gravity.CENTER_HORIZONTAL;
        return p;
    }

    private LinearLayout.LayoutParams centredLp(int topMargin) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        p.topMargin = topMargin;
        p.gravity = Gravity.CENTER_HORIZONTAL;
        return p;
    }

    private GradientDrawable roundRect(int color, int radiusDp) {
        GradientDrawable gd = new GradientDrawable();
        gd.setShape(GradientDrawable.RECTANGLE);
        gd.setCornerRadius(dp(radiusDp));
        gd.setColor(color);
        return gd;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
