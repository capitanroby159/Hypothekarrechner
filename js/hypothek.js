(function(){
  'use strict';
  
  // --- KONFIGURATION ---
  const CONFIG = {
    MAX_LTV: 80.0,           // Maximale Belehnung in %
    MAX_BURDEN: 33.34,       // Maximale Tragbarkeit in %
    RATE_STRESS: 0.05,       // Kalkulatorischer Zinssatz (5%)
    RATE_OP: 0.004,          // Unterhaltskosten (0.4%)
    RATE_RENO: 0.006,        // Rückstellungen (0.6%)
    ALV_CAP: 148200,         // Max. versicherter Lohn ALV 2024
    PENSION_AGE: 65,         // Pensionierungsalter
    MIN_AMORT_YEARS: 1,      // Minimale Amortisationsdauer
    DEFAULT_AMORT_YEARS: 15, // Standard-Amortisationsdauer
    DEATH_CAPITAL_RATE: 0.065, // Kapitalisierungszins für Todesfallkapital
    RESERVE_RATE: 0.10       // Empfohlene Liquiditätsreserve (10%)
  };
  
  const RATE_MAINT = CONFIG.RATE_OP + CONFIG.RATE_RENO;
  
  // Globale Variablen
  let currentMixRate = 0.018;
  let chartP1 = null, chartP2Bar = null, chartP2Donut = null, chartP3Donut = null;
  let data = {};
  
  // Risiko-Gaps speichern für Empfehlungen
  let riskGaps = {
    b1: { alv: 0, iv: 0, death: 0 },
    b2: { alv: 0, iv: 0, death: 0 },
    pension: { b1: 0, b2: 0, both: 0 },
    crash: 0
  };
  
  // --- HELPER FUNKTIONEN ---
  const q = sel => document.querySelector(sel);
  const qAll = sel => document.querySelectorAll(sel);
  
  const parseCHF = str => {
    if (str === null || str === undefined) return 0;
    if (typeof str === 'number') return str;
    const cleanStr = String(str).replace(/['']/g, '').replace(/[^0-9.-]/g, '');
    const result = parseFloat(cleanStr);
    return isNaN(result) ? 0 : result;
  };
  
  const fmtCHF = num => {
    return new Intl.NumberFormat('de-CH', {
      style: 'currency',
      currency: 'CHF',
      maximumFractionDigits: 0
    }).format(num || 0);
  };
  
  const fmtNumber = num => {
    return new Intl.NumberFormat('de-CH').format(num || 0).replace(/,/g, "'");
  };
  
  const getVal = (id) => {
    const el = q(id);
    return el ? parseCHF(el.value) : 0;
  };
  
  const setText = (selector, text) => {
    const el = q(selector);
    if (el) el.textContent = text;
  };
  
  const setClass = (selector, className) => {
    const el = q(selector);
    if (el) el.className = className;
  };

  // --- HAUPTBERECHNUNGEN ---
  function calcAll() {
    const inc1 = getVal('#b1_income');
    const inc2 = getVal('#b2_income');
    const debt1 = getVal('#b1_debt');
    const debt2 = getVal('#b2_debt');
    const ali1 = getVal('#b1_alimony');
    const ali2 = getVal('#b2_alimony');
    
    const totalIncome = inc1 + inc2;
    const totalDeductions = debt1 + debt2 + ali1 + ali2;
    const effectiveIncome = Math.max(0, totalIncome - totalDeductions);

    const sum_acc = getVal('#b1_asset_bank') + getVal('#b2_asset_bank');
    const sum_sec = getVal('#b1_asset_sec') + getVal('#b2_asset_sec');
    const sum_3a = getVal('#b1_asset_3a') + getVal('#b2_asset_3a');
    const sum_pk = getVal('#b1_asset_pk') + getVal('#b2_asset_pk');
    
    const inv_acc_total = getVal('#invest_total_hard');
    const inv_3a_total = getVal('#invest_total_3a');
    const inv_pk_total = getVal('#invest_total_pk');

    const price = getVal('#propertyPrice');
    const reno = getVal('#renovationCost');
    
    let fees = getVal('#fees_total_manual');
    if (fees === 0) {
      fees = getVal('#tax_transfer') + 
             getVal('#fee_notary') + 
             getVal('#fee_registry') + 
             getVal('#fee_mortgage') + 
             getVal('#fee_3a_prefund') + 
             getVal('#fee_pk_wef');
    }

    const totalInvest = price + reno;
    const investedSum = inv_acc_total + inv_3a_total + inv_pk_total;
    const mortgage = Math.max(0, totalInvest - investedSum);
    const ltv = totalInvest > 0 ? (mortgage / totalInvest) * 100 : 0;
    const liquidLeft = (sum_acc + sum_sec) - (inv_acc_total + fees);
    const delta80 = Math.max(0, mortgage - (totalInvest * (CONFIG.MAX_LTV / 100)));
    const cashNeeded = inv_acc_total + fees;

    setText('#sum_investedCapital', fmtCHF(investedSum));
    setText('#sum_buyingFees', fmtCHF(fees));

    const limit65 = totalInvest * 0.65;
    const hypo1 = Math.min(mortgage, limit65);
    const hypo2 = Math.max(0, mortgage - limit65);
    
    let age = 40;
    const birthEl = q('#b1_birth');
    if (birthEl && birthEl.value) {
      const birthDate = new Date(birthEl.value);
      const today = new Date();
      age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
    }
    
    const yearsToRetirement = Math.max(CONFIG.MIN_AMORT_YEARS, CONFIG.PENSION_AGE - age);
    const amortYears = Math.min(CONFIG.DEFAULT_AMORT_YEARS, yearsToRetirement);
    
    const yearlyInterest = mortgage * CONFIG.RATE_STRESS;
    const yearlyAmort = hypo2 > 0 ? hypo2 / amortYears : 0;
    const yearlyMaint = totalInvest * RATE_MAINT;
    const yearlyTotal = yearlyInterest + yearlyAmort + yearlyMaint;
    
    const monthlyInterest = yearlyInterest / 12;
    const monthlyAmort = yearlyAmort / 12;
    const monthlyMaint = yearlyMaint / 12;
    const monthlyTotal = yearlyTotal / 12;
    
    const burden = effectiveIncome > 0 ? (yearlyTotal / effectiveIncome) * 100 : 0;
    const minIncome = yearlyTotal / (CONFIG.MAX_BURDEN / 100);
    
    data = {
      inc1, inc2, debt1, debt2, ali1, ali2,
      totalIncome, totalDeductions, effectiveIncome,
      sum_acc, sum_sec, sum_3a, sum_pk,
      inv_acc_total, inv_3a_total, inv_pk_total,
      price, reno, totalInvest, fees,
      mortgage, ltv, investedSum,
      liquidLeft, delta80, cashNeeded,
      hypo1, hypo2, amortYears,
      yearlyInterest, yearlyAmort, yearlyMaint, yearlyTotal,
      monthlyInterest, monthlyAmort, monthlyMaint, monthlyTotal,
      burden, minIncome,
      age, yearsToRetirement,
      tranches: [],
      p5_total: 0,
      p5_op: 0,
      p5_reno: 0
    };
    
    return data;
  }

  function validateInputs() {
    const errors = [];
    
    const availableHard = data.sum_acc + data.sum_sec;
    if (Math.round(data.inv_acc_total) > Math.round(availableHard)) {
      errors.push(`Fehler Konto: Einsatz (${fmtCHF(data.inv_acc_total)}) übersteigt verfügbares Kapital (${fmtCHF(availableHard)}).`);
    }
    
    if (Math.round(data.inv_3a_total) > Math.round(data.sum_3a)) {
      errors.push(`Fehler 3a: Einsatz (${fmtCHF(data.inv_3a_total)}) übersteigt verfügbares Guthaben (${fmtCHF(data.sum_3a)}).`);
    }
    
    if (Math.round(data.inv_pk_total) > Math.round(data.sum_pk)) {
      errors.push(`Fehler PK: Einsatz (${fmtCHF(data.inv_pk_total)}) übersteigt verfügbares Guthaben (${fmtCHF(data.sum_pk)}).`);
    }
    
    const hardEquity = data.inv_acc_total + data.inv_3a_total;
    const minHardEquity = data.totalInvest * 0.10;
    if (hardEquity < (minHardEquity - 1)) {
      errors.push(`Zu wenig "harte Eigenmittel": Mindestens 10% (${fmtCHF(minHardEquity)}) erforderlich. Aktuell: ${fmtCHF(hardEquity)}.`);
    }
    
    if (data.totalInvest <= 0) {
      errors.push('Bitte geben Sie einen gültigen Kaufpreis ein.');
    }
    
    if (data.effectiveIncome <= 0) {
      errors.push('Das effektive Einkommen muss positiv sein.');
    }
    
    return errors;
  }

  // --- RENDERING FUNKTIONEN ---
  
  function renderP1() {
    setText('#t1_totalInvest', fmtCHF(data.totalInvest));
    setText('#t1_mortgage', fmtCHF(data.mortgage));
    setText('#t1_ltv', `Belehnung: ${data.ltv.toFixed(1)}%`);
    setText('#t1_equity', fmtCHF(data.investedSum));
    setText('#t1_fees', fmtCHF(data.fees));
    setText('#t1_cash', fmtCHF(data.cashNeeded));
    setText('#t1_delta', fmtCHF(data.delta80));

    setClass('#kpi1_mortgage', data.ltv <= CONFIG.MAX_LTV ? 'kpi ok' : 'kpi alert');
    setClass('#kpi1_liquidity', data.liquidLeft >= 0 ? 'kpi ok' : 'kpi alert');
    
    const cashSub = q('#t1_cash')?.nextElementSibling;
    if (cashSub) {
      cashSub.textContent = data.liquidLeft < 0 
        ? `Fehlt: ${fmtCHF(Math.abs(data.liquidLeft))}` 
        : 'Einsatz + Gebühren';
    }

    const recBox = q('#recP1');
    const recBtn = q('#btnToPhase2');
    
    if (recBox) {
      recBox.className = 'kpi';
      if (recBtn) recBtn.style.display = 'none';
      
      if (data.delta80 > 0) {
        recBox.classList.add('alert');
        setText('#recP1_status', 'Belehnung zu hoch');
        setText('#recP1_text', `Die maximale Belehnung von ${CONFIG.MAX_LTV}% wird überschritten. Bitte erhöhen Sie das Eigenkapital um mindestens ${fmtCHF(data.delta80)}.`);
      } else if (data.liquidLeft < 0) {
        recBox.classList.add('warn');
        setText('#recP1_status', 'Liquidität fehlt');
        setText('#recP1_text', `Es fehlen ${fmtCHF(Math.abs(data.liquidLeft))} zur Deckung von Eigenmitteleinsatz und Kaufnebenkosten.`);
      } else {
        recBox.classList.add('ok');
        setText('#recP1_status', 'Machbarkeit OK ✓');
        setText('#recP1_text', 'Die Finanzierung ist grundsätzlich machbar. Prüfen Sie nun die Tragbarkeit.');
        if (recBtn) recBtn.style.display = 'block';
      }
    }
    
    renderChartP1();
  }

  function renderP2() {
    setText('#t2_burden', data.burden.toFixed(1) + '%');
    setText('#t2_minIncome', fmtCHF(data.minIncome));
    setText('#t2_hypo1', fmtCHF(data.hypo1));
    setText('#t2_hypo2', fmtCHF(data.hypo2));
    
    setClass('#kpi2_burden', data.burden <= CONFIG.MAX_BURDEN ? 'kpi ok' : 'kpi alert');
    
    const recBox = q('#recP2');
    const recBtn = q('#btnToPhase3');
    
    if (recBox) {
      recBox.className = 'kpi';
      if (recBtn) recBtn.style.display = 'block';
      
      if (data.burden > CONFIG.MAX_BURDEN) {
        recBox.classList.add('alert');
        setText('#recP2_status', 'Tragbarkeit kritisch');
        setText('#recP2_text', `Die kalkulatorische Belastung von ${data.burden.toFixed(1)}% übersteigt das Maximum von ${CONFIG.MAX_BURDEN}%. Benötigtes Mindesteinkommen: ${fmtCHF(data.minIncome)}.`);
      } else if (data.burden > 30) {
        recBox.classList.add('warn');
        setText('#recP2_status', 'Tragbarkeit grenzwertig');
        setText('#recP2_text', `Die Tragbarkeit liegt bei ${data.burden.toFixed(1)}% - knapp unter dem Maximum. Beachten Sie die Risikoszenarien.`);
      } else {
        recBox.classList.add('ok');
        setText('#recP2_status', 'Tragbarkeit OK ✓');
        setText('#recP2_text', `Mit ${data.burden.toFixed(1)}% liegt die Belastung komfortabel unter dem Maximum von ${CONFIG.MAX_BURDEN}%.`);
      }
    }
    
    renderChartP2Bar();
    renderChartP2Donut();
  }

  function renderRisk() {
    const targetTxt = `Soll: ${fmtCHF(data.minIncome)}`;
    
    // Reset risk gaps
    riskGaps = {
      b1: { alv: 0, iv: 0, death: 0 },
      b2: { alv: 0, iv: 0, death: 0 },
      pension: { b1: 0, b2: 0, both: 0 },
      crash: 0
    };
    
    // --- Käufer 1 Szenarien ---
    
    // Arbeitslosigkeit K1
    const hasKidsOrAlimony1 = getVal('#b1_kids') > 0 || getVal('#b1_alimony') > 0;
    const alvRate1 = hasKidsOrAlimony1 ? 0.8 : 0.7;
    const alvInc1 = Math.min(data.inc1, CONFIG.ALV_CAP) * alvRate1 + data.inc2;
    
    setText('#val_alv', fmtCHF(alvInc1));
    setText('#target_alv', targetTxt);
    
    if (data.minIncome > alvInc1) {
      riskGaps.b1.alv = data.minIncome - alvInc1;
      setText('#gap_alv', `-${fmtCHF(riskGaps.b1.alv)}`);
      setClass('#risk_alv', 'risk-card alert');
      setText('#stat_alv', 'LÜCKE');
    } else {
      setText('#gap_alv', 'Keine');
      setClass('#risk_alv', 'risk-card ok');
      setText('#stat_alv', 'OK');
    }

    // Invalidität K1
    const ivInc1 = getVal('#b1_pension_inv') + data.inc2;
    setText('#val_iv', fmtCHF(ivInc1));
    setText('#target_iv', targetTxt);
    
    if (data.minIncome > ivInc1) {
      riskGaps.b1.iv = data.minIncome - ivInc1;
      setText('#gap_iv', `-${fmtCHF(riskGaps.b1.iv)}`);
      setClass('#risk_iv', 'risk-card warn');
      setText('#stat_iv', 'LÜCKE');
    } else {
      setText('#gap_iv', 'Keine');
      setClass('#risk_iv', 'risk-card ok');
      setText('#stat_iv', 'OK');
    }

    // Todesfall K1
    const deathInc1 = getVal('#b1_pension_death') + data.inc2;
    setText('#val_death', fmtCHF(deathInc1));
    setText('#target_death', targetTxt);
    
    if (deathInc1 < data.minIncome) {
      riskGaps.b1.death = (data.minIncome - deathInc1) / CONFIG.DEATH_CAPITAL_RATE;
      setText('#gap_death', fmtCHF(riskGaps.b1.death));
      setClass('#risk_death', 'risk-card alert');
      setText('#stat_death', 'LÜCKE');
    } else {
      setText('#gap_death', 'Keine');
      setClass('#risk_death', 'risk-card ok');
      setText('#stat_death', 'OK');
    }

    // Immobilien-Crash (-20%)
    const crashMax = data.totalInvest * 0.8 * (CONFIG.MAX_LTV / 100);
    const marginCall = Math.max(0, data.mortgage - crashMax);
    riskGaps.crash = marginCall;
    
    setText('#val_crash', fmtCHF(crashMax));
    
    if (marginCall > 0) {
      setText('#gap_crash', fmtCHF(marginCall));
      setClass('#risk_value', 'risk-card alert');
      setText('#stat_crash', 'NACHSCHUSS');
    } else {
      setText('#gap_crash', 'Keiner');
      setClass('#risk_value', 'risk-card ok');
      setText('#stat_crash', 'OK');
    }

    // --- Käufer 2 Szenarien (falls vorhanden) ---
    const b2Name = q('#b2_name')?.value?.trim() || '';
    const hasB2 = data.inc2 > 0 || b2Name !== '';
    
    const riskRowB2 = q('#risk_row_b2');
    if (riskRowB2) {
      riskRowB2.style.display = hasB2 ? 'block' : 'none';
    }
    
    if (hasB2) {
      // Arbeitslosigkeit K2
      const hasKidsOrAlimony2 = getVal('#b2_kids') > 0 || getVal('#b2_alimony') > 0;
      const alvRate2 = hasKidsOrAlimony2 ? 0.8 : 0.7;
      const alvInc2 = Math.min(data.inc2, CONFIG.ALV_CAP) * alvRate2 + data.inc1;
      
      setText('#val_alv_b2', fmtCHF(alvInc2));
      setText('#target_alv_b2', targetTxt);
      
      if (data.minIncome > alvInc2) {
        riskGaps.b2.alv = data.minIncome - alvInc2;
        setText('#gap_alv_b2', `-${fmtCHF(riskGaps.b2.alv)}`);
        setClass('#risk_alv_b2', 'risk-card alert');
        setText('#stat_alv_b2', 'LÜCKE');
      } else {
        setText('#gap_alv_b2', 'Keine');
        setClass('#risk_alv_b2', 'risk-card ok');
        setText('#stat_alv_b2', 'OK');
      }

      // Invalidität K2
      const ivInc2 = getVal('#b2_pension_inv') + data.inc1;
      setText('#val_iv_b2', fmtCHF(ivInc2));
      setText('#target_iv_b2', targetTxt);
      
      if (data.minIncome > ivInc2) {
        riskGaps.b2.iv = data.minIncome - ivInc2;
        setText('#gap_iv_b2', `-${fmtCHF(riskGaps.b2.iv)}`);
        setClass('#risk_iv_b2', 'risk-card warn');
        setText('#stat_iv_b2', 'LÜCKE');
      } else {
        setText('#gap_iv_b2', 'Keine');
        setClass('#risk_iv_b2', 'risk-card ok');
        setText('#stat_iv_b2', 'OK');
      }

      // Todesfall K2
      const deathInc2 = getVal('#b2_pension_death') + data.inc1;
      setText('#val_death_b2', fmtCHF(deathInc2));
      setText('#target_death_b2', targetTxt);
      
      if (deathInc2 < data.minIncome) {
        riskGaps.b2.death = (data.minIncome - deathInc2) / CONFIG.DEATH_CAPITAL_RATE;
        setText('#gap_death_b2', fmtCHF(riskGaps.b2.death));
        setClass('#risk_death_b2', 'risk-card alert');
        setText('#stat_death_b2', 'LÜCKE');
      } else {
        setText('#gap_death_b2', 'Keine');
        setClass('#risk_death_b2', 'risk-card ok');
        setText('#stat_death_b2', 'OK');
      }
    }

    // Zins-Schock (auf 3%)
    const shockRate = 0.03;
    const shockMonthly = (data.mortgage * shockRate) / 12;
    const currentMonthly = (data.mortgage * currentMixRate) / 12;
    
    if (q('#val_rate_shock')) {
      setText('#val_rate_shock', fmtCHF(shockMonthly));
      setText('#gap_rate_shock', `+ ${fmtCHF(shockMonthly - currentMonthly)}`);
    }

    // --- Pensionierung ---
    const pen1 = getVal('#b1_pension_old');
    const pen2 = getVal('#b2_pension_old');
    const work1 = data.inc1 - data.debt1 - data.ali1;
    const work2 = data.inc2 - data.debt2 - data.ali2;
    
    const costPension = (data.hypo1 * CONFIG.RATE_STRESS) + data.yearlyMaint;
    const targetPension = costPension / (CONFIG.MAX_BURDEN / 100);
    
    const checkPension = (income, valId, gapId, statId, targetId, gapKey) => {
      setText(valId, fmtCHF(income));
      setText(targetId, `Soll: ${fmtCHF(targetPension)}`);
      
      if (income < targetPension) {
        const maxInterest = (income * (CONFIG.MAX_BURDEN / 100)) - data.yearlyMaint;
        const maxHypo = Math.max(0, maxInterest / CONFIG.RATE_STRESS);
        const gap = Math.max(0, data.hypo1 - maxHypo);
        
        if (gap > 0) {
          riskGaps.pension[gapKey] = gap;
          setText(gapId, fmtCHF(gap));
          setText(statId, 'LÜCKE');
          const statEl = q(statId);
          if (statEl) statEl.style.background = 'var(--danger)';
        } else {
          setText(gapId, 'Gedeckt');
          setText(statId, 'OK');
          const statEl = q(statId);
          if (statEl) statEl.style.background = 'var(--ok)';
        }
      } else {
        setText(gapId, 'Gedeckt');
        setText(statId, 'OK');
        const statEl = q(statId);
        if (statEl) statEl.style.background = 'var(--ok)';
      }
    };
    
    checkPension(pen1 + work2, '#val_pen_1', '#gap_pen_1', '#stat_pen_1', '#target_pen_1', 'b1');
    checkPension(pen2 + work1, '#val_pen_2', '#gap_pen_2', '#stat_pen_2', '#target_pen_2', 'b2');
    checkPension(pen1 + pen2, '#val_pen_both', '#gap_pen_both', '#stat_pen_both', '#target_pen_both', 'both');
  }

  // --- EMPFEHLUNGEN RENDERN ---
  
  function renderRecommendations() {
    const b1Name = q('#b1_name')?.value?.trim() || 'Käufer 1';
    const b2Name = q('#b2_name')?.value?.trim() || 'Käufer 2';
    const hasB2 = data.inc2 > 0 || b2Name !== 'Käufer 2';
    
    let hasAnyRec = false;
    
    // --- Versicherungsempfehlungen Käufer 1 ---
    const recB1Grid = q('#rec_insurance_b1_grid');
    const recB1Section = q('#rec_insurance_b1');
    
    if (recB1Grid && recB1Section) {
      recB1Grid.innerHTML = '';
      let hasB1Recs = false;
      
      // Arbeitslosenversicherung (Erwerbsausfall)
      if (riskGaps.b1.alv > 0) {
        hasB1Recs = true;
        recB1Grid.innerHTML += `
          <div class="rec-card">
            <div class="rec-card-title"><span class="icon">🛡️</span> Arbeitslosenversicherung</div>
            <div class="rec-card-body">
              Bei Arbeitslosigkeit fehlen jährlich Mittel zur Deckung der Hypothekarkosten.
            </div>
            <div class="rec-card-value">Deckungslücke: ${fmtCHF(riskGaps.b1.alv)} / Jahr</div>
            <div class="rec-card-hint">Empfehlung: Prüfen Sie eine private Arbeitslosenversicherung oder bauen Sie Reserven auf.</div>
          </div>
        `;
      }
      
      // Erwerbsunfähigkeitsversicherung
      if (riskGaps.b1.iv > 0) {
        hasB1Recs = true;
        recB1Grid.innerHTML += `
          <div class="rec-card warn">
            <div class="rec-card-title"><span class="icon">🏥</span> Erwerbsunfähigkeitsversicherung</div>
            <div class="rec-card-body">
              Die IV- und PK-Leistungen decken bei Invalidität die Hypothekarkosten nicht vollständig.
            </div>
            <div class="rec-card-value">Deckungslücke: ${fmtCHF(riskGaps.b1.iv)} / Jahr</div>
            <div class="rec-card-hint">Empfehlung: Erwerbsunfähigkeitsrente (Langzeit) mit entsprechender Deckungshöhe abschliessen.</div>
          </div>
        `;
      }
      
      // Todesfallversicherung
      if (riskGaps.b1.death > 0) {
        hasB1Recs = true;
        recB1Grid.innerHTML += `
          <div class="rec-card">
            <div class="rec-card-title"><span class="icon">💀</span> Todesfallrisikoversicherung</div>
            <div class="rec-card-body">
              Im Todesfall reichen die Hinterlassenenleistungen nicht aus, um die Tragbarkeit zu gewährleisten.
            </div>
            <div class="rec-card-value">Benötigtes Kapital: ${fmtCHF(riskGaps.b1.death)}</div>
            <div class="rec-card-hint">Empfehlung: Todesfallrisikoversicherung mit Versicherungssumme gemäss Analyse.</div>
          </div>
        `;
      }
      
      recB1Section.style.display = hasB1Recs ? 'block' : 'none';
      if (hasB1Recs) hasAnyRec = true;
    }
    
    // --- Versicherungsempfehlungen Käufer 2 ---
    const recB2Grid = q('#rec_insurance_b2_grid');
    const recB2Section = q('#rec_insurance_b2');
    
    if (recB2Grid && recB2Section && hasB2) {
      recB2Grid.innerHTML = '';
      let hasB2Recs = false;
      
      if (riskGaps.b2.alv > 0) {
        hasB2Recs = true;
        recB2Grid.innerHTML += `
          <div class="rec-card">
            <div class="rec-card-title"><span class="icon">🛡️</span> Arbeitslosenversicherung</div>
            <div class="rec-card-body">
              Bei Arbeitslosigkeit fehlen jährlich Mittel zur Deckung der Hypothekarkosten.
            </div>
            <div class="rec-card-value">Deckungslücke: ${fmtCHF(riskGaps.b2.alv)} / Jahr</div>
            <div class="rec-card-hint">Empfehlung: Prüfen Sie eine private Arbeitslosenversicherung oder bauen Sie Reserven auf.</div>
          </div>
        `;
      }
      
      if (riskGaps.b2.iv > 0) {
        hasB2Recs = true;
        recB2Grid.innerHTML += `
          <div class="rec-card warn">
            <div class="rec-card-title"><span class="icon">🏥</span> Erwerbsunfähigkeitsversicherung</div>
            <div class="rec-card-body">
              Die IV- und PK-Leistungen decken bei Invalidität die Hypothekarkosten nicht vollständig.
            </div>
            <div class="rec-card-value">Deckungslücke: ${fmtCHF(riskGaps.b2.iv)} / Jahr</div>
            <div class="rec-card-hint">Empfehlung: Erwerbsunfähigkeitsrente (Langzeit) mit entsprechender Deckungshöhe abschliessen.</div>
          </div>
        `;
      }
      
      if (riskGaps.b2.death > 0) {
        hasB2Recs = true;
        recB2Grid.innerHTML += `
          <div class="rec-card">
            <div class="rec-card-title"><span class="icon">💀</span> Todesfallrisikoversicherung</div>
            <div class="rec-card-body">
              Im Todesfall reichen die Hinterlassenenleistungen nicht aus, um die Tragbarkeit zu gewährleisten.
            </div>
            <div class="rec-card-value">Benötigtes Kapital: ${fmtCHF(riskGaps.b2.death)}</div>
            <div class="rec-card-hint">Empfehlung: Todesfallrisikoversicherung mit Versicherungssumme gemäss Analyse.</div>
          </div>
        `;
      }
      
      recB2Section.style.display = hasB2Recs ? 'block' : 'none';
      if (hasB2Recs) hasAnyRec = true;
    } else if (recB2Section) {
      recB2Section.style.display = 'none';
    }
    
    // --- Kapitalaufbau-Empfehlungen ---
    const recCapitalGrid = q('#rec_capital_grid');
    
    if (recCapitalGrid) {
      recCapitalGrid.innerHTML = '';
      
      // Pensionierungslücke
      const maxPensionGap = Math.max(riskGaps.pension.b1, riskGaps.pension.b2, riskGaps.pension.both);
      if (maxPensionGap > 0) {
        hasAnyRec = true;
        const yearsUntilPension = Math.max(1, CONFIG.PENSION_AGE - data.age);
        
        recCapitalGrid.innerHTML += `
          <div class="rec-card warn">
            <div class="rec-card-title"><span class="icon">🎯</span> Sparziel Pensionierung</div>
            <div class="rec-card-body">
              Bis zur Pensionierung muss Kapital angespart werden, um die Hypothek auf ein tragbares Niveau zu reduzieren.
            </div>
            <div class="rec-card-value">Benötigtes Kapital: ${fmtCHF(maxPensionGap)}</div>
            <div class="rec-card-hint">Bis Alter 65 (in ca. ${yearsUntilPension} Jahren) ansparen oder Hypothek reduzieren.</div>
          </div>
        `;
      }
      
      // Immobilien-/Zinsrisiko Reserve
      const recommendedReserve = data.totalInvest * CONFIG.RESERVE_RATE;
      const currentLiquidity = data.liquidLeft;
      const reserveGap = recommendedReserve - Math.max(0, currentLiquidity);
      
      recCapitalGrid.innerHTML += `
        <div class="rec-card info">
          <div class="rec-card-title"><span class="icon">🏦</span> Liquiditätsreserve</div>
          <div class="rec-card-body">
            Als Schutz gegen Immobilien- und Zinsrisiken empfehlen wir eine Liquiditätsreserve von 10% des Immobilienwerts.
          </div>
          <div class="rec-card-value">Empfohlene Reserve: ${fmtCHF(recommendedReserve)}</div>
          <div class="rec-card-hint">${reserveGap > 0 
            ? `Nach Kauf fehlen noch ${fmtCHF(reserveGap)} – bitte ansparen.` 
            : `Ihre verbleibende Liquidität von ${fmtCHF(currentLiquidity)} deckt diese Reserve.`}</div>
        </div>
      `;
      
      // Margin-Call Risiko
      if (riskGaps.crash > 0) {
        hasAnyRec = true;
        recCapitalGrid.innerHTML += `
          <div class="rec-card">
            <div class="rec-card-title"><span class="icon">📉</span> Immobilienrisiko (Margin Call)</div>
            <div class="rec-card-body">
              Bei einem Wertverlust von 20% würde die Bank zusätzliches Kapital verlangen (Margin Call).
            </div>
            <div class="rec-card-value">Risikobetrag: ${fmtCHF(riskGaps.crash)}</div>
            <div class="rec-card-hint">Empfehlung: Diesen Betrag als zusätzliche Reserve halten oder Belehnung reduzieren.</div>
          </div>
        `;
      }
    }
    
    // Keine Empfehlungen nötig?
    const recNone = q('#rec_none');
    if (recNone) {
      recNone.style.display = hasAnyRec ? 'none' : 'block';
    }
  }

  // --- CHART FUNKTIONEN ---
  
  function renderChartP1() {
    const chartEl = q('#chartP1');
    if (!chartEl) return;
    
    const series = [
      { name: 'Eigenmittel', data: [data.investedSum] },
      { name: 'Hypothek', data: [data.mortgage] }
    ];
    
    const options = {
      series,
      chart: {
        type: 'bar',
        height: 160,
        stacked: true,
        toolbar: { show: false }
      },
      plotOptions: {
        bar: { horizontal: true }
      },
      colors: ['#198754', '#003366'],
      xaxis: {
        max: data.totalInvest * 1.1,
        labels: { formatter: v => fmtCHF(v) },
        categories: ['']
      },
      yaxis: { show: false },
      tooltip: {
        x: { show: false },
        y: { formatter: v => fmtCHF(v) }
      },
      dataLabels: { enabled: false },
      legend: { show: true, position: 'bottom' },
      annotations: {
        xaxis: [{
          x: data.totalInvest * (CONFIG.MAX_LTV / 100),
          borderColor: '#d32f2f',
          label: {
            text: `Max ${CONFIG.MAX_LTV}%`,
            style: { background: '#d32f2f', color: '#fff' }
          }
        }]
      }
    };
    
    if (chartP1) chartP1.destroy();
    chartP1 = new ApexCharts(chartEl, options);
    chartP1.render();
  }

  function renderChartP2Bar() {
    const chartEl = q('#chartP2_Bar');
    if (!chartEl) return;
    
    const limitMonth = (data.effectiveIncome / 12) * (CONFIG.MAX_BURDEN / 100);
    
    const options = {
      series: [
        { name: 'Zins (5%)', data: [data.monthlyInterest] },
        { name: 'Amortisation', data: [data.monthlyAmort] },
        { name: 'Unterhalt', data: [data.monthlyMaint] }
      ],
      chart: {
        type: 'bar',
        height: 160,
        stacked: true,
        toolbar: { show: false }
      },
      plotOptions: {
        bar: { horizontal: true }
      },
      colors: ['#003366', '#673ab7', '#9e9e9e'],
      xaxis: {
        max: Math.max(data.monthlyTotal * 1.2, limitMonth * 1.1),
        labels: { formatter: v => fmtCHF(v) },
        categories: ['']
      },
      yaxis: { show: false },
      tooltip: {
        x: { show: false },
        y: { formatter: v => fmtCHF(v) }
      },
      dataLabels: { enabled: false },
      legend: { show: true, position: 'bottom' },
      annotations: {
        xaxis: [{
          x: limitMonth,
          borderColor: '#d32f2f',
          label: {
            text: `Limit (${CONFIG.MAX_BURDEN}%)`,
            style: { background: '#d32f2f', color: '#fff' }
          }
        }]
      }
    };
    
    if (chartP2Bar) chartP2Bar.destroy();
    chartP2Bar = new ApexCharts(chartEl, options);
    chartP2Bar.render();
  }

  function renderChartP2Donut() {
    const chartEl = q('#chartP2_Donut');
    if (!chartEl) return;
    
    const options = {
      series: [data.monthlyInterest, data.monthlyAmort, data.monthlyMaint],
      labels: ['Zins (5%)', 'Amortisation', 'Unterhalt'],
      chart: {
        type: 'donut',
        height: 180
      },
      colors: ['#003366', '#673ab7', '#9e9e9e'],
      legend: { show: false },
      tooltip: {
        y: { formatter: v => fmtCHF(v) }
      },
      dataLabels: {
        enabled: true,
        formatter: (v) => Math.round(v) + '%'
      },
      plotOptions: {
        pie: {
          donut: {
            labels: {
              show: true,
              total: {
                show: true,
                label: 'Total',
                formatter: () => fmtCHF(data.monthlyTotal)
              }
            }
          }
        }
      }
    };
    
    if (chartP2Donut) chartP2Donut.destroy();
    chartP2Donut = new ApexCharts(chartEl, options);
    chartP2Donut.render();
  }

  function renderChartP3Donut(interest, opCost, renoCost) {
    const chartEl = q('#chartP3_Donut');
    if (!chartEl) return;
    
    const options = {
      series: [interest, data.monthlyAmort, opCost + renoCost],
      labels: ['Zins (real)', 'Amortisation', 'Unterhalt'],
      chart: {
        type: 'donut',
        height: 180
      },
      colors: ['#198754', '#673ab7', '#9e9e9e'],
      legend: {
        show: true,
        position: 'bottom'
      },
      tooltip: {
        y: { formatter: v => fmtCHF(v) }
      },
      dataLabels: {
        enabled: true,
        formatter: (v) => Math.round(v) + '%'
      }
    };
    
    if (chartP3Donut) chartP3Donut.destroy();
    chartP3Donut = new ApexCharts(chartEl, options);
    chartP3Donut.render();
  }

  // --- PHASE 4 & 5 ---
  
  function reCalcP4() {
    let totalAmount = 0;
    let totalInterest = 0;
    data.tranches = [];
    
    qAll('.tranche-row').forEach(row => {
      const selectEl = row.querySelector('select');
      const amountEl = row.querySelector('.tr-amount');
      const rateEl = row.querySelector('.tr-rate');
      
      if (!selectEl || !amountEl || !rateEl) return;
      
      const product = selectEl.value;
      const amount = parseCHF(amountEl.value);
      const rate = parseFloat(rateEl.value) || 0;
      const yearlyInterest = amount * (rate / 100);
      
      totalAmount += amount;
      totalInterest += yearlyInterest;
      
      data.tranches.push({
        product,
        amount,
        rate,
        mInt: yearlyInterest / 12
      });
    });
    
    const delta = data.mortgage - totalAmount;
    const deltaDisplay = q('#p3_deltaDisplay');
    if (deltaDisplay) {
      if (Math.abs(delta) > 10) {
        deltaDisplay.textContent = `Differenz: ${fmtCHF(delta)}`;
        deltaDisplay.style.color = '#d32f2f';
      } else {
        deltaDisplay.textContent = '✓ Vollständig verteilt';
        deltaDisplay.style.color = '#198754';
      }
    }
    
    let effectiveInterest = totalInterest;
    if (delta > 0) {
      effectiveInterest += delta * 0.025;
    }
    
    const mixRate = data.mortgage > 0 ? effectiveInterest / data.mortgage : 0;
    currentMixRate = mixRate;
    
    const riskSection = q('#sectionResultsRisk');
    if (riskSection && !riskSection.classList.contains('collapsed')) {
      renderRisk();
    }
    
    const monthlyInterest = effectiveInterest / 12;
    const monthlyMaint = (data.totalInvest * RATE_MAINT) / 12;
    const monthlyTotal = monthlyInterest + data.monthlyAmort + monthlyMaint;
    
    data.p5_total = monthlyTotal;
    data.p5_op = monthlyMaint * (CONFIG.RATE_OP / RATE_MAINT);
    data.p5_reno = monthlyMaint * (CONFIG.RATE_RENO / RATE_MAINT);

    setText('#p3_targetHypo', fmtCHF(data.mortgage));
    setText('#t3_monthlyTotalReal', fmtCHF(monthlyTotal));
    setText('#t3_mixRate', `Mischzins: ${(mixRate * 100).toFixed(2)}%`);
    setText('#t3_interest', fmtCHF(monthlyInterest));
    setText('#t3_amort', fmtCHF(data.monthlyAmort));
    setText('#t3_opCost', fmtCHF(data.p5_op));
    setText('#t3_renoReserve', fmtCHF(data.p5_reno));
    
    const realBurden = (monthlyTotal * 12 / data.effectiveIncome) * 100;
    const kpi3 = q('#kpi3_total');
    if (kpi3) {
      kpi3.className = realBurden <= CONFIG.MAX_BURDEN ? 'kpi ok' : 'kpi warn';
    }
    
    renderChartP3Donut(monthlyInterest, data.p5_op, data.p5_reno);
  }

  function renderP5() {
    const grid = q('#cost_summary_grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    if (data.tranches && data.tranches.length > 0) {
      data.tranches.forEach(tranche => {
        let warning = '';
        if (tranche.product.includes('SARON')) {
          warning = `<div style="font-size:11px; color:#e67e22; margin-top:4px;">⚠️ Variable Rate</div>`;
        }
        
        grid.innerHTML += `
          <div class="kpi">
            <div class="kpi-label">${tranche.product}</div>
            <div class="kpi-value" style="font-size:18px">${fmtCHF(tranche.amount)}</div>
            <div class="kpi-sub">Zins: ${tranche.rate.toFixed(2)}% (${fmtCHF(tranche.mInt)}/Mt)</div>
            ${warning}
          </div>
        `;
      });
    }
    
    grid.innerHTML += `
      <div class="kpi">
        <div class="kpi-label">Amortisation</div>
        <div class="kpi-value" style="font-size:18px">${fmtCHF(data.monthlyAmort)}</div>
        <div class="kpi-sub">Pflicht (2. Hypothek)</div>
      </div>
    `;
    
    grid.innerHTML += `
      <div class="kpi">
        <div class="kpi-label">Unterhalt & Rücklagen</div>
        <div class="kpi-value" style="font-size:18px">${fmtCHF(data.p5_op + data.p5_reno)}</div>
        <div class="kpi-sub">Kalkuliert 1% p.a.</div>
      </div>
    `;
    
    grid.innerHTML += `
      <div class="kpi highlight">
        <div class="kpi-label">Total Monatliche Wohnkosten</div>
        <div class="kpi-value">${fmtCHF(data.p5_total)}</div>
        <div class="kpi-sub">Ihre effektive Belastung</div>
      </div>
    `;
    
    // Empfehlungen rendern
    renderRecommendations();
  }

  // --- TRANCHEN-VERWALTUNG ---
  
  function getProductOptions() {
    const products = [
      'Fix 2 Jahre', 'Fix 3 Jahre', 'Fix 4 Jahre', 'Fix 5 Jahre',
      'Fix 6 Jahre', 'Fix 7 Jahre', 'Fix 8 Jahre', 'Fix 9 Jahre',
      'Fix 10 Jahre', 'Fix 12 Jahre', 'Fix 15 Jahre', 'SARON'
    ];
    return products.map(p => `<option value="${p}">${p}</option>`).join('');
  }
  
  function addTrancheHTML(amount = 0, rate = 1.8) {
    const container = q('#trancheContainer');
    if (!container || container.children.length >= 4) return;
    
    const row = document.createElement('div');
    row.className = 'tranche-row';
    row.innerHTML = `
      <div class="tranche-select-group">
        <select>${getProductOptions()}</select>
      </div>
      <div class="tranche-input-group">
        <input type="text" class="money tr-amount" value="${fmtCHF(amount)}">
      </div>
      <div class="tranche-input-group">
        <input type="number" step="0.01" class="tr-rate" value="${rate}" placeholder="Zins %">
      </div>
      <button class="btn-del-tranche" title="Tranche entfernen">×</button>
    `;
    
    const amountInput = row.querySelector('.tr-amount');
    const rateInput = row.querySelector('.tr-rate');
    const deleteBtn = row.querySelector('.btn-del-tranche');
    
    amountInput.addEventListener('change', (e) => {
      e.target.value = fmtCHF(parseCHF(e.target.value));
      updateTrancheZero();
      reCalcP4();
    });
    
    rateInput.addEventListener('input', reCalcP4);
    
    deleteBtn.addEventListener('click', () => {
      row.remove();
      updateTrancheZero();
      reCalcP4();
    });
    
    container.appendChild(row);
  }
  
  function updateTrancheZero() {
    const container = q('#trancheContainer');
    if (!container) return;
    
    const rows = container.children;
    if (rows.length < 2) return;
    
    let sum = 0;
    for (let i = 1; i < rows.length; i++) {
      const amountEl = rows[i].querySelector('.tr-amount');
      if (amountEl) {
        sum += parseCHF(amountEl.value);
      }
    }
    
    const firstAmount = rows[0].querySelector('.tr-amount');
    if (firstAmount) {
      firstAmount.value = fmtCHF(Math.max(0, data.mortgage - sum));
    }
  }
  
  function initTranches() {
    const container = q('#trancheContainer');
    if (container) {
      container.innerHTML = '';
    }
    addTrancheHTML(data.mortgage, 1.8);
    reCalcP4();
  }

  // --- NAVIGATION ---
  
  function showSection(sectionId) {
    const section = q(sectionId);
    if (section) {
      section.classList.remove('collapsed');
      section.scrollIntoView({ behavior: 'smooth' });
    }
  }
  
  function hideSection(sectionId) {
    const section = q(sectionId);
    if (section) {
      section.classList.add('collapsed');
    }
  }
  
  function setActiveStep(stepNum) {
    qAll('.step').forEach(s => s.classList.remove('active'));
    const step = q(`#step${stepNum}-ind`);
    if (step) step.classList.add('active');
  }

  // --- EVENT LISTENERS ---
  
  function initEventListeners() {
    qAll('.money').forEach(el => {
      el.addEventListener('change', (e) => {
        e.target.value = fmtNumber(parseCHF(e.target.value));
        calcAll();
      });
    });
    
    const btnCalcP1 = q('#btnCalcPhase1');
    if (btnCalcP1) {
      btnCalcP1.addEventListener('click', () => {
        calcAll();
        const errors = validateInputs();
        const banner = q('#validationBanner');
        
        if (errors.length > 0) {
          if (banner) {
            banner.style.display = 'block';
            banner.innerHTML = errors.join('<br>');
          }
        } else {
          if (banner) banner.style.display = 'none';
          hideSection('#sectionInputs');
          showSection('#sectionResultsP1');
          renderP1();
          setActiveStep(1);
        }
      });
    }
    
    const btnEditP1 = q('#btnEditP1');
    if (btnEditP1) {
      btnEditP1.addEventListener('click', () => {
        ['#sectionResultsP1', '#sectionResultsP2', '#sectionResultsRisk', '#sectionResultsP4', '#sectionResultsP5']
          .forEach(s => hideSection(s));
        
        const inputSection = q('#sectionInputs');
        if (inputSection) inputSection.classList.remove('collapsed');
        
        qAll('.step').forEach(s => s.classList.remove('active'));
        setActiveStep(1);
      });
    }
    
    const btnToP2 = q('#btnToPhase2');
    if (btnToP2) {
      btnToP2.addEventListener('click', () => {
        showSection('#sectionResultsP2');
        renderP2();
        setActiveStep(2);
      });
    }
    
    const btnToP3 = q('#btnToPhase3');
    if (btnToP3) {
      btnToP3.addEventListener('click', () => {
        showSection('#sectionResultsRisk');
        renderRisk();
        setActiveStep(3);
      });
    }
    
    const btnToP4 = q('#btnToPhase4');
    if (btnToP4) {
      btnToP4.addEventListener('click', () => {
        showSection('#sectionResultsP4');
        initTranches();
        setActiveStep(4);
      });
    }
    
    const btnToP5 = q('#btnToPhase5');
    if (btnToP5) {
      btnToP5.addEventListener('click', () => {
        reCalcP4();
        showSection('#sectionResultsP5');
        renderP5();
        setActiveStep(5);
      });
    }
    
    const btnBackToP2 = q('#btnBackToP2');
    if (btnBackToP2) {
      btnBackToP2.addEventListener('click', () => {
        hideSection('#sectionResultsRisk');
        setActiveStep(2);
        q('#sectionResultsP2')?.scrollIntoView({ behavior: 'smooth' });
      });
    }
    
    const btnBackToRisk = q('#btnBackToRisk');
    if (btnBackToRisk) {
      btnBackToRisk.addEventListener('click', () => {
        hideSection('#sectionResultsP4');
        setActiveStep(3);
        q('#sectionResultsRisk')?.scrollIntoView({ behavior: 'smooth' });
      });
    }
    
    const btnBackToP4 = q('#btnBackToP4');
    if (btnBackToP4) {
      btnBackToP4.addEventListener('click', () => {
        hideSection('#sectionResultsP5');
        setActiveStep(4);
        q('#sectionResultsP4')?.scrollIntoView({ behavior: 'smooth' });
      });
    }
    
    const btnAddTranche = q('#btnAddTranche');
    if (btnAddTranche) {
      btnAddTranche.addEventListener('click', () => {
        addTrancheHTML(0, 1.8);
        reCalcP4();
      });
    }
  }

  // --- INITIALISIERUNG ---
  
  function init() {
    const defaultBirthdate = new Date();
    defaultBirthdate.setFullYear(defaultBirthdate.getFullYear() - 35);
    const dateStr = defaultBirthdate.toISOString().split('T')[0];
    
    const b1Birth = q('#b1_birth');
    const b2Birth = q('#b2_birth');
    
    if (b1Birth && !b1Birth.value) b1Birth.value = dateStr;
    if (b2Birth && !b2Birth.value) b2Birth.value = dateStr;
    
    initEventListeners();
    calcAll();
    
    console.log('Hypothekar-Cockpit initialisiert');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();