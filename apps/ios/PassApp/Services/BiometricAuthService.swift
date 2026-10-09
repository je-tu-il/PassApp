import Foundation
import LocalAuthentication

public final class BiometricAuthService {
    public static let shared = BiometricAuthService()

    private init() {}

    public enum BiometricType {
        case none
        case touchID
        case faceID
    }

    public var biometricType: BiometricType {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            return .none
        }
        switch context.biometryType {
        case .faceID:
            return .faceID
        case .touchID:
            return .touchID
        default:
            return .none
        }
    }

    public func authenticateWithBiometrics(reason: String = "Déverrouiller PassApp avec Face ID") async -> Result<Bool, Error> {
        let context = LAContext()
        context.localizedCancelTitle = "Annuler"
        var error: NSError?

        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            if let error = error {
                return .failure(error)
            }
            return .failure(NSError(domain: "PassAppAuth", code: -1, userInfo: [NSLocalizedDescriptionKey: "Biométrie indisponible"]))
        }

        do {
            let success = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
            return .success(success)
        } catch {
            return .failure(error)
        }
    }
}
