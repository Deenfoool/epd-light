const text = (value) => String(value ?? '')
const address = (a = {}) => ({
  zipCode: text(a.zipCode), region: text(a.region), city: text(a.city), settlement: text(a.settlement),
  street: text(a.street), building: text(a.building), corpus: text(a.corpus), apartment: text(a.apartment),
})
const party = (p = {}) => ({
  kind: p.kind === 'ip' ? 'ip' : 'org', name: text(p.name), inn: text(p.inn), kpp: text(p.kpp),
  address: text(p.address), russianAddress: address(p.russianAddress), phone: text(p.phone), email: text(p.email), edoId: text(p.edoId),
})
const number = (value) => Number(text(value).replace(',', '.')) || 0

/**
 * Rebuilds the operator candidate from the canonical documents row loaded by backend.
 * This deliberately does not trust any Integration JSON previously submitted by a browser.
 */
export function buildCanonicalOperatorCandidate(row) {
  if (!row || typeof row !== 'object' || !text(row.id).trim()) throw new Error('canonical document row is required')
  const d = row.data && typeof row.data === 'object' ? row.data : {}
  const cargo = Array.isArray(d.cargo) ? d.cargo : []
  const totals = cargo.reduce((acc, item) => ({
    places: acc.places + number(item?.places),
    weight: acc.weight + number(item?.weight),
  }), { places: 0, weight: 0 })
  const route = d.route || {}
  const transport = d.transport || {}
  const terms = d.terms || {}
  const loading = d.loadingDetails || {}

  return {
    kind: 'epd-light/operator-candidate-v1',
    draftModelVersion: 4,
    canonicalSource: 'server-documents-row',
    readiness: { candidate: false, requiresServerValidation: true },
    document: {
      internalId: text(row.id),
      number: text(row.doc_number),
      date: text(row.doc_date),
      orderNumber: text(terms.orderNumber),
      orderDate: text(terms.orderDate),
      contractNumber: text(terms.contractNumber),
      contractDate: text(terms.contractDate),
    },
    participants: {
      shipper: party(d.shipper),
      consignee: party(d.consignee),
      carrier: party(d.carrier),
    },
    route: {
      loadingAddress: text(route.loadAddress),
      loadingRussianAddress: address(route.loadRussianAddress),
      plannedLoadingDate: text(route.loadDate),
      plannedLoadingTime: text(route.loadTime),
      actualArrival: text(route.loadArrival),
      actualDeparture: text(route.loadDeparture),
      unloadingAddress: text(route.unloadAddress),
      unloadingRussianAddress: address(route.unloadRussianAddress),
      plannedUnloadingDate: text(route.unloadDate),
      plannedUnloadingTime: text(route.unloadTime),
      note: text(route.note),
    },
    loadingFacts: {
      actualGrossWeight: text(route.actualWeight) || (totals.weight ? String(totals.weight) : ''),
      actualPlaces: text(route.actualPlaces) || (totals.places ? String(totals.places) : ''),
      massDeterminationMethod: text(route.massMethod),
    },
    loadingDetails: {
      matchingShipper: text(loading.matchingShipper),
      employeeFullName: text(loading.employeeFullName),
      employeePosition: text(loading.employeePosition),
      employeeResponsibilities: text(loading.employeeResponsibilities),
      partyInn: text(loading.partyInn) || (text(loading.matchingShipper) === '1' ? text(d.shipper?.inn) : ''),
      ownerType: text(loading.ownerType),
      ownerInn: text(loading.ownerInn),
    },
    cargo: cargo.map((item) => ({
      internalId: text(item?.id), name: text(item?.name), state: text(item?.state), places: text(item?.places), unit: text(item?.unit),
      grossWeightKg: text(item?.weight), declaredValue: text(item?.value), currencyCode: text(item?.currency) || '643',
      packaging: text(item?.packaging), packagingMethod: text(item?.packagingMethod), packagingCode: text(item?.packagingCode),
      marking: text(item?.marking), specialConditions: text(item?.conditions),
    })),
    vehicle: {
      registrationNumber: text(transport.plate), trailerRegistrationNumber: text(transport.trailerPlate), type: text(transport.vehicleType),
      brand: text(transport.brand), model: text(transport.model), ownershipType: text(transport.ownershipType),
      loadCapacity: text(transport.loadCapacity), volumeCapacity: text(transport.volumeCapacity),
    },
    driver: {
      fullName: text(transport.driverName), phone: text(transport.driverPhone), licenseLegacy: text(transport.driverLicense),
      licenseSeries: text(transport.driverLicenseSeries), licenseNumber: text(transport.driverLicenseNumber),
      licenseIssueDate: text(transport.driverLicenseDate), waybillNumber: text(transport.waybillNumber), waybillDate: text(transport.waybillDate),
    },
    shipperInstructions: {
      instructions: text(terms.shipperInstructions), redirectionContact: text(terms.redirectionContact),
    },
    signer: { fullName: text(d.signer?.fullName), position: text(d.signer?.position) },
    commercial: { carriagePrice: text(terms.price), comment: text(terms.comment), extra: text(terms.extra) },
  }
}

export const CANONICAL_OPERATOR_CANDIDATE_POLICY = Object.freeze({
  sourceTable: 'documents',
  clientIntegrationJsonTrusted: false,
  serverRevalidationRequired: true,
  draftModelVersion: 4,
})
